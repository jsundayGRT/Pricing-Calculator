import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { listActivity } from '../../src/lib/activity';
import { approveQuote, decisionOf, declineQuote, getQuoteById, upsertQuote } from '../../src/lib/quotes';
import {
  APPROVE_ACTION,
  DECLINE_ACTION,
  DECLINE_MODAL,
  dealReviewBlocks,
  declineModal,
  declineReason,
  notifyRepInSlack,
  openDeclineModal,
  postDealReview,
  refreshDealReviewMessage,
  setSlackFetchForTests,
  slackUser,
  verifySlackSignature,
} from '../../src/lib/slack';

// Deal Review approvals in Slack, against a fake Slack API.

let dir: string;
type Call = { method: string; body: Record<string, unknown> | string };
let calls: Call[];

test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grt-slack-'));
  process.env.DATA_DIR = dir;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DEAL_REVIEW_CHANNEL = 'C0DEALS';
  process.env.SLACK_SIGNING_SECRET = 'shh';
  calls = [];
  setSlackFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/api/')[1];
    const raw = String(init?.body ?? '');
    const body = raw.startsWith('{') ? JSON.parse(raw) : raw;
    calls.push({ method, body });
    if (method === 'chat.postMessage') return Response.json({ ok: true, channel: 'C0DEALS', ts: '1730000000.000100' });
    if (method === 'users.lookupByEmail') {
      return String(body).includes('avery%40guardrail.tech')
        ? Response.json({ ok: true, user: { id: 'UAVERY' } })
        : Response.json({ ok: false, error: 'users_not_found' });
    }
    if (method === 'users.info') return Response.json({ ok: true, user: { profile: { real_name: 'Susan Landaluce', email: 'susan.landaluce@guardrail.tech' } } });
    return Response.json({ ok: true });
  }) as typeof fetch);
});
test.afterEach(() => {
  setSlackFetchForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

function lock(status: string) {
  return upsertQuote({
    ownerId: 'u1',
    ownerEmail: 'avery@guardrail.tech',
    ownerName: 'Avery Rep',
    snapshot: {
      requestId: 'GRT-SLACK1',
      version: 1,
      customerName: 'Northwind',
      status,
      rep: 'Avery Rep',
      // As the calculator saves a non-Enterprise request: seats 0, typed employee count in included.
      inputs: { band: 'SMB', seats: 0, term: '1-Year', modules: { shadow: true } },
      customer: { finalPrice: 100594, fx: { currency: 'USD' }, included: { governedEmployees: 100, customerEmployees: 80 } },
      internal: { finalMarginPct: 0.41, regionalTargetPct: 0.55, reviewReason: 'Discount at the margin floor' },
      hubspotDeal: { id: '555', name: 'Northwind – Platform' },
    },
  });
}

const buttons = (blocks: unknown[]) =>
  (blocks as { type: string; elements?: { action_id: string; value: string }[] }[]).find((b) => b.type === 'actions')?.elements || [];

test('a Deal Review posts to the channel with Approve and Decline', async () => {
  const record = await lock('DEAL REVIEW');
  await postDealReview(record.id, 'https://calc.example');

  const post = calls.find((c) => c.method === 'chat.postMessage')!;
  const body = post.body as { channel: string; blocks: unknown[]; text: string };
  expect(body.channel).toBe('C0DEALS');
  expect(body.text).toContain('Northwind');
  expect(buttons(body.blocks).map((b) => [b.action_id, b.value])).toEqual([
    [APPROVE_ACTION, record.id],
    [DECLINE_ACTION, record.id],
  ]);
  const text = JSON.stringify(body.blocks);
  expect(text).toContain('$100,594');
  expect(text).toContain('Discount at the margin floor');
  expect(text).toContain('SMB, 80 employees');
  expect(text).toContain('https://calc.example/executive');
  expect((await getQuoteById(record.id))!.slack).toEqual({ channel: 'C0DEALS', ts: '1730000000.000100' });

  // Posting again (a retry, or re-saving the same version) doesn't duplicate the message.
  await postDealReview(record.id, 'https://calc.example');
  expect(calls.filter((c) => c.method === 'chat.postMessage').length).toBe(1);
});

test('a standard request is not posted', async () => {
  const record = await lock('STANDARD');
  await postDealReview(record.id, 'https://calc.example');
  expect(calls.length).toBe(0);
});

test('nothing is posted when Slack is not configured', async () => {
  delete process.env.SLACK_BOT_TOKEN;
  const record = await lock('DEAL REVIEW');
  await postDealReview(record.id, 'https://calc.example');
  expect(calls.length).toBe(0);
});

test('a decision replaces the buttons with who decided', async () => {
  const record = await lock('DEAL REVIEW');
  await postDealReview(record.id, 'https://calc.example');
  const who = await slackUser('U123', 'susan');
  expect(who).toEqual({ name: 'Susan Landaluce', email: 'susan.landaluce@guardrail.tech' });
  await approveQuote(record.id, who, 'Approved in Slack');
  await refreshDealReviewMessage(record.id, 'https://calc.example');

  const update = calls.find((c) => c.method === 'chat.update')!;
  const body = update.body as { channel: string; ts: string; blocks: unknown[] };
  expect([body.channel, body.ts]).toEqual(['C0DEALS', '1730000000.000100']);
  expect(buttons(body.blocks)).toEqual([]);
  expect(JSON.stringify(body.blocks)).toContain('Approved* by Susan Landaluce');
  expect((await getQuoteById(record.id))!.status).toBe('APPROVED');
});

test('a declined request shows as declined', async () => {
  const record = await lock('DEAL REVIEW');
  const declined = (await declineQuote(record.id, { name: 'Dena Lumbang', email: 'dena@guardrail.tech' }, 'Declined in Slack'))!;
  const text = JSON.stringify(dealReviewBlocks(declined, 'https://calc.example'));
  expect(text).toContain('Declined* by Dena Lumbang');
  expect(text).toContain('Declined in Slack');
});

test('only correctly signed, recent Slack requests are accepted', () => {
  const body = 'payload=%7B%7D';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac('sha256', 'shh').update(`v0:${ts}:${body}`).digest('hex')}`;
  expect(verifySlackSignature(body, ts, sig)).toBe(true);
  expect(verifySlackSignature(body + 'x', ts, sig)).toBe(false);
  // change the last character (to one it isn't already)
  expect(verifySlackSignature(body, ts, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'))).toBe(false);
  expect(verifySlackSignature(body, String(Number(ts) - 600), sig)).toBe(false);
  expect(verifySlackSignature(body, ts, null)).toBe(false);
});

test('Decline asks for a reason in a pop-up before declining', async () => {
  const record = await lock('DEAL REVIEW');
  // The Decline button opens the pop-up instead of a yes/no confirm.
  const decline = (dealReviewBlocks(record, 'https://calc.example') as { type: string; elements?: { action_id: string; confirm?: unknown }[] }[])
    .find((b) => b.type === 'actions')!.elements!.find((e) => e.action_id === DECLINE_ACTION)!;
  expect(decline.confirm).toBeUndefined();

  await openDeclineModal('trigger-1', record);
  const open = calls.find((c) => c.method === 'views.open')!.body as { trigger_id: string; view: ReturnType<typeof declineModal> };
  expect(open.trigger_id).toBe('trigger-1');
  expect(open.view.callback_id).toBe(DECLINE_MODAL);
  expect(open.view.private_metadata).toBe(record.id);
  expect(JSON.stringify(open.view.blocks)).toContain('Why is it not approved?');

  // What Slack sends back when the pop-up is submitted.
  const submitted = { state: { values: { reason: { reason_input: { value: '  Margin too thin for a pilot  ' } } } } };
  expect(declineReason(submitted)).toBe('Margin too thin for a pilot');
  expect(declineReason({ state: { values: { reason: { reason_input: { value: '   ' } } } } })).toBe('');
  // Nothing is decided until the pop-up is submitted.
  expect((await getQuoteById(record.id))!.status).toBe('DEAL REVIEW');
});

test('the dashboard sees who decided and the reason', async () => {
  const record = await lock('DEAL REVIEW');
  const declined = (await declineQuote(record.id, { name: 'Susan Landaluce', email: 's@guardrail.tech' }, 'Margin too thin'))!;
  expect(decisionOf(declined)).toMatchObject({ outcome: 'not-approved', by: 'Susan Landaluce', note: 'Margin too thin' });

  const approved = (await approveQuote(record.id, { name: 'Dena Lumbang', email: 'd@guardrail.tech' }, 'Approved in Slack'))!;
  expect(decisionOf(approved)).toMatchObject({ outcome: 'approved', by: 'Dena Lumbang', note: 'Approved in Slack' });
  expect(decisionOf({ ...approved, status: 'DEAL REVIEW' })).toBeNull();
});

test('the rep gets a Slack message when their Deal Review is approved', async () => {
  const record = await lock('DEAL REVIEW');
  await approveQuote(record.id, { name: 'Susan Landaluce', email: 'susan@guardrail.tech' });
  await notifyRepInSlack(record.id, 'https://calc.example');

  expect(calls.find((c) => c.method === 'users.lookupByEmail')!.body).toBe('email=avery%40guardrail.tech');
  const dm = calls.find((c) => c.method === 'chat.postMessage')!.body as { channel: string; text: string; blocks: unknown[] };
  expect(dm.channel).toBe('UAVERY');
  expect(dm.text).toBe('Approved: your Deal Review for Northwind');
  const text = JSON.stringify(dm.blocks);
  expect(text).toContain('Susan Landaluce');
  expect(text).toContain('$100,594');
  expect(text).toContain('Quote valid until');
  expect(text).toContain('https://calc.example/');
  expect((await listActivity())[0]).toMatchObject({ type: 'slack-sent', detail: 'Messaged avery@guardrail.tech in Slack' });
});

test('a declined rep sees the reason, and nothing goes out before a decision', async () => {
  const record = await lock('DEAL REVIEW');
  await notifyRepInSlack(record.id, 'https://calc.example');
  expect(calls).toHaveLength(0);
  await declineQuote(record.id, { name: 'Dena Lumbang', email: 'dena@guardrail.tech' }, 'Smaller discount, please');
  await notifyRepInSlack(record.id, 'https://calc.example');
  const dm = calls.find((c) => c.method === 'chat.postMessage')!.body as { text: string; blocks: unknown[] };
  expect(dm.text).toContain('Not approved');
  expect(JSON.stringify(dm.blocks)).toContain('Smaller discount, please');
  expect(JSON.stringify(dm.blocks)).not.toContain('Quote valid until');
});

test('a rep without a Slack account is noted in the change history', async () => {
  const record = await upsertQuote({
    ownerId: 'u2',
    ownerEmail: 'nobody@guardrail.tech',
    ownerName: 'No Slack',
    snapshot: { requestId: 'GRT-SLACK9', version: 1, customerName: 'Contoso', status: 'DEAL REVIEW' },
  });
  await approveQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  await notifyRepInSlack(record.id, 'https://calc.example');
  expect(calls.filter((c) => c.method === 'chat.postMessage')).toHaveLength(0);
  expect((await listActivity())[0]).toMatchObject({
    type: 'slack-failed',
    detail: 'Could not message the rep in Slack: no Slack user has the email nobody@guardrail.tech',
  });
});
