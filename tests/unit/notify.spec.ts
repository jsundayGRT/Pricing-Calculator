import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { setEmailFetchForTests } from '../../src/lib/email';
import { notifyAvailable, notifyPrefsFor, notifyRepOfDecision, setNotifyPrefs } from '../../src/lib/notify';
import { approveQuote, upsertQuote } from '../../src/lib/quotes';
import { setSlackFetchForTests } from '../../src/lib/slack';

// The rep's choice of how to hear about a Deal Review decision (fake Slack and Microsoft Graph).

let dir: string;
let slackCalls: string[], mailCalls: string[];

test.beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grt-notify-'));
  process.env.DATA_DIR = dir;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.MAIL_FROM = 'pricing@guardrail.tech';
  process.env.AZURE_AD_TENANT_ID = 'tenant';
  process.env.AZURE_AD_CLIENT_ID = 'client';
  process.env.AZURE_AD_CLIENT_SECRET = 'secret';
  delete process.env.EMAIL_DRY_RUN;
  slackCalls = []; mailCalls = [];
  setSlackFetchForTests((async (url: string | URL | Request) => {
    const method = String(url).split('/').pop() as string;
    slackCalls.push(method);
    if (method === 'users.lookupByEmail') return Response.json({ ok: true, user: { id: 'U1' } });
    return Response.json({ ok: true, ts: '1.2', channel: 'D1' });
  }) as typeof fetch);
  setEmailFetchForTests((async (url: string | URL | Request) => {
    if (String(url).includes('/oauth2/v2.0/token')) return Response.json({ access_token: 't', expires_in: 3600 });
    mailCalls.push(String(url));
    return new Response(null, { status: 202 });
  }) as typeof fetch);
});
test.afterEach(() => {
  setSlackFetchForTests(null);
  setEmailFetchForTests(null);
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.MAIL_FROM;
  rmSync(dir, { recursive: true, force: true });
});

async function approvedReview() {
  const q = await upsertQuote({
    ownerId: 'u1', ownerEmail: 'Avery@guardrail.tech', ownerName: 'Avery Rep',
    snapshot: { requestId: 'GRT-N1', version: 1, customerName: 'Northwind', status: 'DEAL REVIEW', lockedAt: '2026-11-01T15:00:00.000Z',
      customer: { finalPrice: 100000, quoteValidDays: 30, fx: { currency: 'USD' } } },
  });
  await approveQuote(q.id, { name: 'Dena', email: 'dena.lumbang@guardrail.tech' });
  return q.id;
}

test('both are on until the rep turns one off', async () => {
  expect(await notifyPrefsFor('avery@guardrail.tech')).toEqual({ email: true, slack: true });
  expect(notifyAvailable()).toEqual({ email: true, slack: true });
  const id = await approvedReview();
  await notifyRepOfDecision(id, 'https://pricing.example');
  expect(slackCalls).toContain('chat.postMessage');
  expect(mailCalls.some((u) => u.includes('/sendMail'))).toBe(true);
});

test('a rep who turned Slack off only gets the email', async () => {
  await setNotifyPrefs('AVERY@guardrail.tech', { slack: false });
  expect(await notifyPrefsFor('avery@guardrail.tech')).toEqual({ email: true, slack: false });
  const id = await approvedReview();
  await notifyRepOfDecision(id, 'https://pricing.example');
  expect(slackCalls).toEqual([]);
  expect(mailCalls.some((u) => u.includes('/sendMail'))).toBe(true);
});

test('a rep who turned email off only gets the Slack message', async () => {
  await setNotifyPrefs('avery@guardrail.tech', { email: false });
  const id = await approvedReview();
  await notifyRepOfDecision(id, 'https://pricing.example');
  expect(slackCalls).toContain('chat.postMessage');
  expect(mailCalls).toEqual([]);
});

test('channels that are not set up show as unavailable', async () => {
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.MAIL_FROM;
  expect(notifyAvailable()).toEqual({ email: false, slack: false });
});
