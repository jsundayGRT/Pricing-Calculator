import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { listActivity } from '../../src/lib/activity';
import { emailDecisionToRep, setEmailFetchForTests } from '../../src/lib/email';
import { daysLeft, quoteExpiry } from '../../src/lib/expiry';
import { approveQuote, declineQuote, deleteQuoteForUser, getQuoteById, upsertQuote } from '../../src/lib/quotes';

// Emailing the rep a decision (against a fake Microsoft Graph), quote expiry, and the change history.

let dir: string;
type Call = { url: string; body: string };
let calls: Call[];
let sendStatus = 202;

test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grt-email-'));
  process.env.DATA_DIR = dir;
  process.env.MAIL_FROM = 'pricing@guardrail.tech';
  process.env.AZURE_AD_TENANT_ID = 'tenant';
  process.env.AZURE_AD_CLIENT_ID = 'client';
  process.env.AZURE_AD_CLIENT_SECRET = 'secret';
  delete process.env.EMAIL_DRY_RUN;
  calls = [];
  sendStatus = 202;
  setEmailFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    if (String(url).includes('/oauth2/v2.0/token')) return Response.json({ access_token: 'graph-token', expires_in: 3600 });
    if (sendStatus !== 202) return Response.json({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, { status: sendStatus });
    return new Response(null, { status: 202 });
  }) as typeof fetch);
});
test.afterEach(() => {
  setEmailFetchForTests(null);
  delete process.env.MAIL_FROM;
  rmSync(dir, { recursive: true, force: true });
});

function lock(status: string, extra: Record<string, unknown> = {}) {
  return upsertQuote({
    ownerId: 'u1',
    ownerEmail: 'avery@guardrail.tech',
    ownerName: 'Avery Rep',
    snapshot: {
      requestId: 'GRT-MAIL1',
      version: 1,
      customerName: 'Northwind <Health>',
      status,
      lockedAt: '2026-11-01T15:00:00.000Z',
      customer: { finalPrice: 100594, quoteValidDays: 30, fx: { currency: 'USD' } },
      hubspotDeal: { id: '555', name: 'Northwind – Platform' },
      ...extra,
    },
  });
}

const sent = () => calls.filter((c) => c.url.includes('/sendMail'));

test('an approval emails the rep from MAIL_FROM', async () => {
  const record = await lock('DEAL REVIEW');
  await approveQuote(record.id, { name: 'Susan Landaluce', email: 'susan@guardrail.tech' });
  await emailDecisionToRep(record.id, 'https://calc.example');

  expect(sent()).toHaveLength(1);
  expect(sent()[0].url).toBe('https://graph.microsoft.com/v1.0/users/pricing%40guardrail.tech/sendMail');
  const msg = JSON.parse(sent()[0].body).message;
  expect(msg.toRecipients).toEqual([{ emailAddress: { address: 'avery@guardrail.tech' } }]);
  expect(msg.subject).toBe('Approved: Deal Review for Northwind <Health> (GRT-MAIL1)');
  expect(msg.body.content).toContain('Approved by');
  expect(msg.body.content).toContain('Susan Landaluce');
  expect(msg.body.content).toContain('$100,594');
  expect(msg.body.content).toContain('Quote valid until');
  expect(msg.body.content).toContain('Northwind &lt;Health&gt;'); // escaped
  expect(msg.body.content).toContain('https://calc.example/');

  const types = (await listActivity()).map((e) => e.type);
  expect(types).toEqual(['emailed', 'approved', 'locked']);
});

test('a decline emails the reason', async () => {
  const record = await lock('DEAL REVIEW');
  await declineQuote(record.id, { name: 'Dena Lumbang', email: 'dena@guardrail.tech' }, 'Ask for a smaller discount');
  await emailDecisionToRep(record.id, 'https://calc.example');
  const msg = JSON.parse(sent()[0].body).message;
  expect(msg.subject).toContain('Not approved');
  expect(msg.body.content).toContain('Ask for a smaller discount');
  expect(msg.body.content).not.toContain('Quote valid until');
});

test('nothing is sent without MAIL_FROM, or before a decision', async () => {
  const record = await lock('DEAL REVIEW');
  await emailDecisionToRep(record.id, 'https://calc.example'); // not decided yet
  delete process.env.MAIL_FROM;
  await approveQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  await emailDecisionToRep(record.id, 'https://calc.example');
  expect(calls).toHaveLength(0);
});

test('a mail failure is recorded, not thrown', async () => {
  sendStatus = 403;
  const record = await lock('DEAL REVIEW');
  await approveQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  await emailDecisionToRep(record.id, 'https://calc.example');
  const [latest] = await listActivity();
  expect(latest.type).toBe('email-failed');
  expect(latest.detail).toContain('ErrorAccessDenied');
});

test('a Standard quote expires from when it was locked; a Deal Review from its approval', async () => {
  const standard = await lock('STANDARD');
  expect(quoteExpiry(standard)).toBe('2026-12-01T15:00:00.000Z');

  const review = await lock('DEAL REVIEW', { requestId: 'GRT-MAIL2' });
  expect(quoteExpiry(review)).toBeNull();
  await approveQuote(review.id, { name: 'Susan', email: 's@guardrail.tech' });
  const approved = (await getQuoteById(review.id))!;
  const approvedOn = (approved.snapshot.approval as { at: string }).at;
  expect(quoteExpiry(approved)!.slice(0, 10)).toBe(
    new Date(Date.parse(`${approvedOn}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10),
  );

  expect(daysLeft('2026-11-10T12:00:00.000Z', new Date(2026, 10, 7, 9))).toBe(3);
  expect(daysLeft('2026-11-01T12:00:00.000Z', new Date(2026, 10, 7, 9))).toBeLessThan(0);
});

test('removing a request is in the change history', async () => {
  const record = await lock('STANDARD');
  await lock('STANDARD'); // re-saving the same version isn't a new lock
  expect(await deleteQuoteForUser('u1', record.id)).toBe(true);
  const events = await listActivity({ requestId: 'GRT-MAIL1' });
  expect(events.map((e) => [e.type, e.by])).toEqual([['deleted', 'Avery Rep'], ['locked', 'Avery Rep']]);
});

test('the valid-until date the rep picked is the expiry, once approved', async () => {
  const picked = await lock('STANDARD', { requestId: 'GRT-PICK1', customer: { finalPrice: 1, validUntil: '2027-01-15', quoteValidDays: 69, fx: { currency: 'USD' } } });
  expect(quoteExpiry(picked)).toBe('2027-01-15T12:00:00.000Z');

  const review = await lock('DEAL REVIEW', { requestId: 'GRT-PICK2', customer: { finalPrice: 1, validUntil: '2027-03-01', fx: { currency: 'USD' } } });
  expect(quoteExpiry(review)).toBeNull(); // waiting for approval
  await approveQuote(review.id, { name: 'Susan', email: 's@guardrail.tech' });
  // the picked date stands; it doesn't restart at approval
  expect(quoteExpiry((await getQuoteById(review.id))!)).toBe('2027-03-01T12:00:00.000Z');
});
