import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { approveQuote, declineQuote, getQuoteById, upsertQuote } from '../../src/lib/quotes';
import {
  APPROVE_ACTION,
  DECLINE_ACTION,
  dealReviewBlocks,
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
      inputs: { band: 'SMB', seats: 80, term: '1-Year', modules: { shadow: true } },
      customer: { finalPrice: 100594, fx: { currency: 'USD' } },
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
  expect(verifySlackSignature(body, ts, sig.replace(/.$/, '0'))).toBe(false);
  expect(verifySlackSignature(body, String(Number(ts) - 600), sig)).toBe(false);
  expect(verifySlackSignature(body, ts, null)).toBe(false);
});
