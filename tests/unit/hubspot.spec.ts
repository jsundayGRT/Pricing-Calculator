import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createHubSpotClient } from '../../src/lib/hubspot/client';
import { buildQuotePricing } from '../../src/lib/hubspot/payload';
import { resetHubSpotCaches, syncRequestToHubSpot } from '../../src/lib/hubspot/sync';
import { approveQuote, declineQuote, getQuoteById, saveQuotePdf, upsertQuote } from '../../src/lib/quotes';
import { scenarios } from '../scenarios';

// ---- the real pricing engine, loaded from the calculator page
const html = readFileSync(path.join(__dirname, '..', '..', 'content', 'calculator.html'), 'utf8');
const engineSrc = html.slice(html.indexOf('const Engine = (function'), html.indexOf('const Schema = (function'));
const Engine = new Function(`${engineSrc}; return Engine;`)() as {
  calculate: (raw: Record<string, unknown>, cfg: unknown) => { inputs: unknown; customer: Record<string, unknown>; internal: Record<string, unknown> };
};
const cfgJson = html.match(/<script type="application\/json" id="grt-config">([\s\S]*?)<\/script>/)![1];
const CONFIG = JSON.parse(cfgJson).config;

type Priced = { inputs: unknown; customer: Record<string, unknown>; internal: Record<string, unknown> };

function priced(id = 'mid-market-suite', fx = { currency: 'USD', rate: 1 }): Priced {
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  const yn = (b: boolean) => (b ? 'Y' : 'N');
  const r = Engine.calculate({
    band: s.band, location: s.location, seats: s.seats, employeeCount: s.employees,
    modules: Object.fromEntries(s.modules.map((k) => [k, 'Y'])),
    pilot: s.pilot ? { shadow: 'Y' } : {}, pilotCredit: 'Y',
    term: s.term, earlyPay: yn(s.earlyPay), commandCenter: yn(s.commandCenter), onPrem: yn(s.onPrem),
    scopedOnPremPrice: s.scoped, variableDiscountPct: s.discount,
  }, CONFIG);
  return { ...r, customer: { ...r.customer, fx } };
}

// Values that only exist in the executive view. None may appear in anything sent to HubSpot.
const SECRET = 987654.321;
function snapshotFor(result = priced(), dealId = '555'): Record<string, unknown> {
  return {
    schema: 'grt-pricing-request/1', requestId: 'GRT-TEST1', version: 1, customerName: 'Northwind', rep: 'Avery Rep',
    stage: 'Confirmed', lockedAt: '2026-11-05T02:30:00.000Z', status: result.customer.dealStatus,
    hubspotDeal: { id: dealId, name: 'Northwind – Platform' }, hubspotRecord: dealId,
    inputs: result.inputs, customer: result.customer,
    internal: { ...result.internal, finalMarginPct: SECRET, costs: { totalCostToServe: SECRET } },
  };
}

// ---- a fake HubSpot that records every call
type Call = { method: string; path: string; body: unknown };
function fakeHubSpot(overrides: (call: Call, n: number) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  let n = 0;
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method || 'GET';
    const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.keys()].map((k) => [k, String(init.body instanceof FormData ? init.body.get(k) : '')]))
      : init?.body ? JSON.parse(String(init.body)) : undefined;
    const call = { method, path: u.pathname + u.search, body };
    calls.push(call);
    n += 1;
    const forced = overrides(call, n);
    if (forced) return forced;
    if (u.pathname === '/account-info/v3/details') return json({ portalId: 4242, uiDomain: 'app-na2.hubspot.com', timeZone: 'US/Eastern' });
    if (method === 'GET' && u.pathname.startsWith('/crm/v3/objects/deals/')) return json({ id: '555', properties: { dealname: 'Northwind – Platform' } });
    if (u.pathname.endsWith('/associations/companies')) return json({ results: [{ toObjectId: 11, associationTypes: [{ typeId: 341 }] }, { toObjectId: 12, associationTypes: [{ typeId: 5 }] }] });
    if (u.pathname.endsWith('/associations/contacts')) return json({ results: [{ toObjectId: 21, associationTypes: [{ typeId: 3 }] }] });
    if (u.pathname.startsWith('/crm/v3/properties/deals/')) return json({ name: 'pricing_request_id' });
    if (method === 'POST' && u.pathname === '/crm/v3/objects/line_items') return json({ id: `li-${n}` }, 201);
    if (method === 'POST' && u.pathname === '/crm/v3/objects/quotes') return json({ id: 'q-1' }, 201);
    if (method === 'POST' && u.pathname === '/files/v3/files') return json({ id: 'file-1' }, 201);
    if (method === 'POST' && u.pathname === '/crm/v3/objects/notes') return json({ id: 'note-1' }, 201);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json({ id: 'ok' });
  }) as typeof fetch;
  return { calls, fetchFn };
}

let dir = '';
test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grt-hubspot-'));
  process.env.DATA_DIR = dir;
  process.env.HUBSPOT_QUOTE_TEMPLATE_ID = 'tpl-9';
  process.env.HUBSPOT_QUOTE_EXPIRY_DAYS = '30';
  delete process.env.HUBSPOT_PORTAL_ID;
  resetHubSpotCaches();
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function lockRequest(snapshot = snapshotFor()) {
  const record = await upsertQuote({ ownerId: 'u1', ownerEmail: 'avery@guardrail.tech', ownerName: 'Avery Rep', snapshot });
  await saveQuotePdf(record.id, new TextEncoder().encode('%PDF-1.7\nfake quote\n%%EOF\n'));
  return record;
}

const quiet = { log: () => {}, sleep: async () => {} };

test('line items add up to the final price on the PDF', () => {
  for (const s of scenarios) {
    const r = priced(s.id);
    const pricing = buildQuotePricing(snapshotFor(r));
    expect(r.customer.finalPrice as number, s.id).toBeGreaterThan(0);
    expect(pricing.lineItems.length, s.id).toBeGreaterThan(0);
    expect(pricing.total, s.id).toBeCloseTo(r.customer.finalPrice as number, 0);
    for (const li of pricing.lineItems) {
      expect(li.discount, `${s.id} ${li.name}`).toBeGreaterThanOrEqual(0);
      expect(li.discount, `${s.id} ${li.name}`).toBeLessThanOrEqual(li.price);
    }
  }
});

test('prices are sent in the quote currency', () => {
  const r = priced('mid-market-suite', { currency: 'AUD', rate: 1.42 });
  const pricing = buildQuotePricing(snapshotFor(r));
  expect(pricing.currency).toBe('AUD');
  expect(pricing.total).toBeCloseTo((r.customer.finalPrice as number) * 1.42, 0);
});

test('a lock creates the quote, line items, deal update and PDF note', async () => {
  const record = await lockRequest();
  const hs = fakeHubSpot();
  const client = createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet });
  const res = await syncRequestToHubSpot(record.id, { client, now: new Date('2026-11-05T02:40:00Z') });
  expect(res.ok).toBe(true);

  const lineItems = hs.calls.filter((c) => c.method === 'POST' && c.path === '/crm/v3/objects/line_items');
  expect(lineItems.length).toBe(buildQuotePricing(record.snapshot).lineItems.length);
  for (const li of lineItems) {
    const body = li.body as { associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
    expect(body.associations[0]).toMatchObject({ to: { id: '555' }, types: [{ associationTypeId: 20 }] });
  }

  const quote = hs.calls.find((c) => c.method === 'POST' && c.path === '/crm/v3/objects/quotes')!;
  const qb = quote.body as { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
  expect(qb.properties).toMatchObject({
    hs_title: 'Northwind – Platform – Pricing – GRT-TEST1 v1',
    hs_status: 'DRAFT',
    hs_expiration_date: '2026-12-04',
    hs_comments: 'Pricing calculator PDF (GRT-TEST1 v1, Guardrail team only): https://app-na2.hubspot.com/files/4242/?showDetails=file-1',
  });
  const linked = qb.associations.map((a) => `${a.types[0].associationTypeId}:${a.to.id}`);
  expect(linked).toEqual(expect.arrayContaining(['64:555', '286:tpl-9', '69:21', '71:12']));
  expect(linked.filter((x) => x.startsWith('67:')).length).toBe(lineItems.length);

  const dealPatch = hs.calls.find((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/deals/555')!;
  expect(dealPatch.body).toEqual({
    properties: { amount: buildQuotePricing(record.snapshot).total.toFixed(2), pricing_request_id: 'GRT-TEST1 v1' },
  });

  const upload = hs.calls.find((c) => c.path === '/files/v3/files')!;
  expect(upload.body).toMatchObject({ folderPath: 'Pricing Calculator' });
  expect(JSON.parse((upload.body as Record<string, string>).options)).toMatchObject({ access: 'PRIVATE' });

  const note = hs.calls.find((c) => c.method === 'POST' && c.path === '/crm/v3/objects/notes')!;
  const nb = note.body as { properties: Record<string, string> };
  expect(nb.properties.hs_attachment_ids).toBe('file-1');
  expect(nb.properties.hs_note_body).toContain('Pricing request GRT-TEST1 v1 locked by Avery Rep on 2026-11-04.');
  expect(nb.properties.hs_note_body).toContain('https://app-na2.hubspot.com/contacts/4242/record/0-14/q-1');

  const saved = (await getQuoteById(record.id))!.hubspot!;
  expect(saved).toMatchObject({ status: 'synced', quoteId: 'q-1', fileId: 'file-1', noteId: 'note-1', error: null });
  expect(saved.quoteUrl).toBe('https://app-na2.hubspot.com/contacts/4242/record/0-14/q-1');
});

test('nothing executive-only is sent to HubSpot', async () => {
  const record = await lockRequest();
  const hs = fakeHubSpot();
  await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet }) });
  const sent = JSON.stringify(hs.calls.map((c) => c.body));
  expect(sent).not.toContain(String(SECRET));
  expect(sent).not.toMatch(/margin|costToServe|cost_to_serve/i);
});

test('syncing again updates the same quote instead of creating another', async () => {
  const record = await lockRequest();
  const first = fakeHubSpot();
  await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: first.fetchFn, ...quiet }) });
  const oldLineItems = (await getQuoteById(record.id))!.hubspot!.lineItemIds!;

  const second = fakeHubSpot();
  const res = await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: second.fetchFn, ...quiet }) });
  expect(res.ok).toBe(true);
  expect(second.calls.some((c) => c.method === 'POST' && c.path === '/crm/v3/objects/quotes')).toBe(false);
  const patch = second.calls.find((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/quotes/q-1')!;
  expect((patch.body as { properties: Record<string, string> }).properties.hs_status).toBeUndefined();
  for (const id of oldLineItems) {
    expect(second.calls.some((c) => c.method === 'DELETE' && c.path === `/crm/v3/objects/line_items/${id}`)).toBe(true);
  }
  expect(second.calls.some((c) => c.path === '/files/v3/files')).toBe(false);
  expect(second.calls.some((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/notes/note-1')).toBe(true);
  expect((await getQuoteById(record.id))!.hubspot!.attempts).toBe(2);
});

test('a 429 is retried with backoff', async () => {
  const record = await lockRequest();
  const waits: number[] = [];
  let limited = 0;
  const hs = fakeHubSpot((call) => {
    if (call.path === '/crm/v3/objects/quotes' && call.method === 'POST' && limited < 2) {
      limited += 1;
      return new Response('{"message":"rate limited"}', { status: 429, headers: limited === 1 ? { 'retry-after': '2' } : {} });
    }
    return undefined;
  });
  const client = createHubSpotClient({ token: 'test', fetch: hs.fetchFn, log: () => {}, sleep: async (ms) => { waits.push(ms); } });
  const res = await syncRequestToHubSpot(record.id, { client });
  expect(res.ok).toBe(true);
  expect(waits).toEqual([2000, 1000]);
});

test('a failure marks the request and keeps the lock', async () => {
  const record = await lockRequest();
  const hs = fakeHubSpot((call) => (call.path === '/crm/v3/objects/quotes' && call.method === 'POST'
    ? new Response('{"message":"Template not found"}', { status: 400 })
    : undefined));
  const errors: unknown[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const res = await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet }) });
    expect(res.ok).toBe(false);
  } finally {
    console.error = origError;
  }
  const saved = (await getQuoteById(record.id))!;
  expect(saved.status).toBe(record.status);
  expect(saved.hubspot).toMatchObject({ status: 'failed' });
  expect(saved.hubspot!.error).toContain('Template not found');
  // The PDF was uploaded before the failure; a retry must reuse it, not upload a second copy.
  expect(saved.hubspot!.fileId).toBe('file-1');
  const retry = fakeHubSpot();
  await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: retry.fetchFn, ...quiet }) });
  expect(retry.calls.some((c) => c.path === '/files/v3/files')).toBe(false);
  expect((await getQuoteById(record.id))!.hubspot!.status).toBe('synced');
  expect(errors.length).toBe(1);
});

test('the deal property is created when missing', async () => {
  const record = await lockRequest();
  const hs = fakeHubSpot((call) => (call.method === 'GET' && call.path.startsWith('/crm/v3/properties/deals/')
    ? new Response('{"message":"not found"}', { status: 404 })
    : undefined));
  await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet }) });
  const created = hs.calls.find((c) => c.method === 'POST' && c.path === '/crm/v3/properties/deals')!;
  expect(created.body).toMatchObject({ name: 'pricing_request_id', label: 'Pricing request ID', groupName: 'dealinformation' });
});

test('dry run logs payloads and calls nothing', async () => {
  const record = await lockRequest();
  const hs = fakeHubSpot();
  const logged: string[] = [];
  const client = createHubSpotClient({ dryRun: true, fetch: hs.fetchFn, log: (m) => { logged.push(m); } });
  const res = await syncRequestToHubSpot(record.id, { client });
  expect(res.ok).toBe(true);
  expect(hs.calls.length).toBe(0);
  expect(logged.some((m) => m.startsWith('DRY RUN POST /crm/v3/objects/quotes'))).toBe(true);
  expect((await getQuoteById(record.id))!.hubspot!.status).toBe('synced');
});

test('a request without a deal is not synced', async () => {
  const snap = { ...snapshotFor(), hubspotDeal: null, hubspotRecord: null };
  const record = await lockRequest(snap);
  const hs = fakeHubSpot();
  const res = await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet }) });
  expect(res.ok).toBe(false);
  expect(hs.calls.length).toBe(0);
});

test('a Deal Review goes to HubSpot only once approved', async () => {
  const record = await lockRequest({ ...snapshotFor(), status: 'DEAL REVIEW' });
  expect(record.hubspot!.status).toBe('awaiting-approval');

  // Before approval (a retry, for example): nothing is sent.
  const before = fakeHubSpot();
  const res = await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: before.fetchFn, ...quiet }) });
  expect(res.ok).toBe(false);
  expect(before.calls.length).toBe(0);
  expect((await getQuoteById(record.id))!.hubspot!.status).toBe('awaiting-approval');

  await approveQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  const after = fakeHubSpot();
  expect((await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: after.fetchFn, ...quiet }) })).ok).toBe(true);
  expect(after.calls.some((c) => c.method === 'POST' && c.path === '/crm/v3/objects/quotes')).toBe(true);
  expect((await getQuoteById(record.id))!.hubspot!.status).toBe('synced');
});

test('a declined Deal Review is never sent to HubSpot', async () => {
  const record = await lockRequest({ ...snapshotFor(), status: 'DEAL REVIEW' });
  await declineQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  const hs = fakeHubSpot();
  const res = await syncRequestToHubSpot(record.id, { client: createHubSpotClient({ token: 'test', fetch: hs.fetchFn, ...quiet }) });
  expect(res.ok).toBe(false);
  expect(hs.calls.length).toBe(0);
});
