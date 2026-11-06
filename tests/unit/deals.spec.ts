import { expect, test } from '@playwright/test';
import { createHubSpotClient } from '../../src/lib/hubspot/client';
import { dealsForOwnerEmail, resetDealCachesForTests } from '../../src/lib/hubspot/deals';

type Call = { method: string; path: string; body: unknown };

// A fake HubSpot: one pipeline with two stages; `owners` answers the owner lookup.
function fakeHubSpot(owners: (path: string) => Response) {
  const calls: Call[] = [];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = u.pathname + u.search;
    calls.push({ method: init?.method || 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.pathname === '/crm/v3/pipelines/deals') {
      return json({ results: [{ id: 'p1', label: 'Guardrail Sales Pipeline', stages: [{ id: 's1', label: 'Discovery' }, { id: 's2', label: 'Proposal' }] }] });
    }
    if (u.pathname === '/crm/v3/owners') return owners(path);
    if (u.pathname === '/crm/v3/objects/deals/search') {
      return json({ results: [
        { id: '11', properties: { dealname: 'AT&T – Platform', amount: '50000', dealstage: 's2' } },
        { id: '12', properties: { dealname: 'AT&T – Expansion', amount: null, dealstage: 's1' } },
      ] });
    }
    return json({}, 404);
  }) as typeof fetch;
  return { calls, client: createHubSpotClient({ token: 'test', fetch: fetchFn, log: () => {}, sleep: async () => {} }) };
}

test.beforeEach(() => {
  delete process.env.HUBSPOT_PIPELINE_ID;
  resetDealCachesForTests();
});

test("a rep's dropdown lists only their own open deals in the pipeline", async () => {
  const hs = fakeHubSpot(() => new Response(JSON.stringify({ results: [{ id: '777', email: 'avery@guardrail.tech' }] })));
  const mine = await dealsForOwnerEmail('Avery@Guardrail.tech', hs.client);
  expect(mine.status).toBe('ok');
  expect(mine.deals).toEqual([
    { id: '11', name: 'AT&T – Platform', amount: 50000, stage: 'Proposal' },
    { id: '12', name: 'AT&T – Expansion', amount: null, stage: 'Discovery' },
  ]);

  const owner = hs.calls.find((c) => c.path.startsWith('/crm/v3/owners'))!;
  expect(owner.path).toContain('email=avery%40guardrail.tech');
  const search = hs.calls.find((c) => c.path === '/crm/v3/objects/deals/search')!;
  const filters = (search.body as { filterGroups: { filters: unknown[] }[] }).filterGroups[0].filters;
  expect(filters).toEqual([
    { propertyName: 'pipeline', operator: 'EQ', value: 'p1' },
    { propertyName: 'hubspot_owner_id', operator: 'EQ', value: '777' },
    { propertyName: 'hs_is_closed', operator: 'NEQ', value: 'true' },
  ]);
});

test('someone who is not a HubSpot user gets no deals', async () => {
  const hs = fakeHubSpot(() => new Response(JSON.stringify({ results: [] })));
  expect(await dealsForOwnerEmail('new.rep@guardrail.tech', hs.client)).toEqual({ status: 'no-owner', deals: [] });
  expect(hs.calls.some((c) => c.path === '/crm/v3/objects/deals/search')).toBe(false);
});

test('a HubSpot key without the owners scope is reported, not thrown', async () => {
  const hs = fakeHubSpot(() => new Response(JSON.stringify({ message: 'missing scopes' }), { status: 403 }));
  expect(await dealsForOwnerEmail('avery@guardrail.tech', hs.client)).toEqual({ status: 'owners-unavailable', deals: [] });
});
