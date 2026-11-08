// Deal Review approvals in Slack. When a locked request needs a Deal Review, a message with
// Approve / Decline buttons is posted to SLACK_DEAL_REVIEW_CHANNEL. Clicking a button decides the
// request (same as the Executive Dashboard) and the message is updated to show who decided.
//
// Settings: SLACK_BOT_TOKEN (xoxb-…, scopes chat:write, users:read, users:read.email),
// SLACK_SIGNING_SECRET, SLACK_DEAL_REVIEW_CHANNEL (channel ID, e.g. C0123ABCD). The bot must be
// invited to the channel.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { recordActivity } from './activity';
import { quoteExpiry } from './expiry';
import { decisionOf, getQuoteById, setQuoteSlack, type QuoteRecord } from './quotes';
import { summarizeForExec, type ExecQuoteSummary } from './quote-view';

export const APPROVE_ACTION = 'deal_review_approve';
export const DECLINE_ACTION = 'deal_review_decline';
// The pop-up that asks for the reason when someone clicks Decline.
export const DECLINE_MODAL = 'deal_review_decline_reason';

export function slackEnabled() {
  return !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_DEAL_REVIEW_CHANNEL;
}

type FetchFn = typeof fetch;
let fetchOverride: FetchFn | null = null;
// For tests: send Slack calls to a fake.
export function setSlackFetchForTests(fn: FetchFn | null) {
  fetchOverride = fn;
}

// Write methods take JSON; read methods like users.info only take form fields.
export async function slackApi<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
  { form = false } = {},
): Promise<T> {
  const res = await (fetchOverride ?? fetch)(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN || ''}`,
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
    },
    body: form
      ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString()
      : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error || res.status}`);
  return data;
}

// Slack signs every request it sends us; reject anything unsigned, tampered with or replayed.
export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null, now = Date.now()) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 60 * 5) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`);

// $ for US dollars; other currencies by their code (AUD 100,594), as in the calculator.
function money(v: number | null, currency: string | null) {
  if (v == null) return '—';
  const pre = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${pre}${Math.round(v).toLocaleString('en-US')}`;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function summaryBlocks(quote: QuoteRecord, s: ExecQuoteSummary, appUrl: string) {
  const deal = quote.hubspot?.dealName ? esc(quote.hubspot.dealName) : '—';
  const fields = [
    `*Request*\n${esc(s.requestId)} v${s.version}`,
    `*Rep*\n${esc(s.rep)}`,
    `*Final price · Year 1*\n${money(s.finalPrice, s.currency)}`,
    `*Discount requested / applied*\n${pct(s.discountRequestedPct)} / ${pct(s.discountAppliedPct)}`,
    `*Margin / target*\n${pct(s.finalMarginPct)} / ${pct(s.regionalTargetPct)}`,
    `*Term*\n${esc(s.term || '—')}`,
    `*Customer size*\n${esc([s.band, s.seats != null ? `${s.seats.toLocaleString('en-US')} employees` : null].filter(Boolean).join(', ') || '—')}`,
    `*HubSpot deal*\n${deal}`,
  ];
  return [
    { type: 'header', text: { type: 'plain_text', text: `Deal Review: ${s.customerName}`.slice(0, 150) } },
    { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) },
    ...(s.reviewReason
      ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Why it needs review*\n${esc(s.reviewReason)}` } }]
      : []),
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${appUrl}/executive|Open in the Executive Dashboard>` }],
    },
  ];
}

export function dealReviewBlocks(quote: QuoteRecord, appUrl: string) {
  const s = summarizeForExec(quote);
  const blocks: unknown[] = summaryBlocks(quote, s, appUrl);
  const decision = decisionOf(quote);
  if (decision) {
    const icon = decision.outcome === 'approved' ? ':white_check_mark: *Approved*' : ':x: *Declined*';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${icon} by ${esc(decision.by)} on ${esc(decision.at)}${decision.note ? `\n> ${esc(decision.note)}` : ''}` },
    });
  } else {
    blocks.push({
      type: 'actions',
      block_id: 'deal_review',
      elements: [
        {
          type: 'button',
          action_id: APPROVE_ACTION,
          style: 'primary',
          text: { type: 'plain_text', text: 'Approve' },
          value: quote.id,
          confirm: confirmDialog('Approve this Deal Review?', `${s.customerName}, ${money(s.finalPrice, s.currency)} Year 1.`, 'Approve'),
        },
        {
          type: 'button',
          action_id: DECLINE_ACTION,
          style: 'danger',
          text: { type: 'plain_text', text: 'Decline' },
          value: quote.id,
          // No confirm here: Decline opens a pop-up asking for the reason, which is the confirmation.
        },
      ],
    });
  }
  return blocks;
}

function confirmDialog(title: string, text: string, confirm: string) {
  return {
    title: { type: 'plain_text', text: title },
    text: { type: 'plain_text', text: text.slice(0, 300) },
    confirm: { type: 'plain_text', text: confirm },
    deny: { type: 'plain_text', text: 'Cancel' },
  };
}

export function declineModal(quote: QuoteRecord) {
  return {
    type: 'modal',
    callback_id: DECLINE_MODAL,
    private_metadata: quote.id,
    title: { type: 'plain_text', text: 'Decline Deal Review' },
    submit: { type: 'plain_text', text: 'Decline' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${esc(quote.customerName)}* · ${esc(quote.requestId)} v${quote.version}\nThe rep sees this reason on their dashboard.` },
      },
      {
        type: 'input',
        block_id: 'reason',
        label: { type: 'plain_text', text: 'Why is it not approved?' },
        element: { type: 'plain_text_input', action_id: 'reason_input', multiline: true, max_length: 500 },
      },
    ],
  };
}

export async function openDeclineModal(triggerId: string, quote: QuoteRecord) {
  await slackApi('views.open', { trigger_id: triggerId, view: declineModal(quote) });
}

type ModalState = { state?: { values?: Record<string, Record<string, { value?: string | null }>> } };
export function declineReason(view: ModalState) {
  return (view.state?.values?.reason?.reason_input?.value || '').trim();
}

const fallbackText = (quote: QuoteRecord) => `Deal Review: ${quote.customerName} (${quote.requestId} v${quote.version})`;

// Posts the Deal Review message once per request version. Never throws: Slack being down must
// not affect the lock.
export async function postDealReview(recordId: string, appUrl: string) {
  try {
    if (!slackEnabled()) return;
    const quote = await getQuoteById(recordId);
    if (!quote || quote.status !== 'DEAL REVIEW' || quote.slack) return;
    const res = await slackApi<{ channel: string; ts: string }>('chat.postMessage', {
      channel: process.env.SLACK_DEAL_REVIEW_CHANNEL,
      text: fallbackText(quote),
      blocks: dealReviewBlocks(quote, appUrl),
      unfurl_links: false,
    });
    await setQuoteSlack(quote.id, { channel: res.channel, ts: res.ts });
  } catch (err) {
    console.error(`[slack] posting the Deal Review for ${recordId} failed:`, err);
  }
}

// Rewrites the posted message to match the request (e.g. after a decision, from Slack or the
// Executive Dashboard). Never throws.
export async function refreshDealReviewMessage(recordId: string, appUrl: string) {
  try {
    if (!slackEnabled()) return;
    const quote = await getQuoteById(recordId);
    if (!quote?.slack) return;
    await slackApi('chat.update', {
      channel: quote.slack.channel,
      ts: quote.slack.ts,
      text: fallbackText(quote),
      blocks: dealReviewBlocks(quote, appUrl),
    });
  } catch (err) {
    console.error(`[slack] updating the Deal Review message for ${recordId} failed:`, err);
  }
}

// Who clicked, by their Slack profile name and email when the bot can read them.
export async function slackUser(id: string, fallbackName: string) {
  try {
    const res = await slackApi<{ user?: { real_name?: string; profile?: { real_name?: string; display_name?: string; email?: string } } }>(
      'users.info',
      { user: id },
      { form: true },
    );
    const p = res.user?.profile || {};
    return { name: p.real_name || res.user?.real_name || p.display_name || fallbackName, email: p.email || `slack:${id}` };
  } catch {
    return { name: fallbackName, email: `slack:${id}` };
  }
}

// The message the rep gets from the app when their Deal Review is decided.
export function repDecisionBlocks(quote: QuoteRecord, appUrl: string) {
  const decision = decisionOf(quote);
  if (!decision) return null;
  const approved = decision.outcome === 'approved';
  const expires = approved ? quoteExpiry(quote) : null;
  const fields = [
    `*Customer*\n${esc(quote.customerName)}`,
    `*Request*\n${esc(quote.requestId)} v${quote.version}`,
    `*Final price · Year 1*\n${money(quote.finalPrice ?? null, quote.currency ?? null)}`,
    `*${approved ? 'Approved' : 'Declined'} by*\n${esc(decision.by)}`,
    ...(quote.hubspot?.dealName ? [`*HubSpot deal*\n${esc(quote.hubspot.dealName)}`] : []),
    ...(expires
      ? [`*Quote valid until*\n${new Date(expires).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}`]
      : []),
  ];
  const headline = approved
    ? `:white_check_mark: *Approved:* your Deal Review for ${esc(quote.customerName)}. The quote PDF is ready on your dashboard.`
    : `:x: *Not approved:* your Deal Review for ${esc(quote.customerName)}. Revise it on your dashboard and lock a new version.`;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    { type: 'section', fields: fields.map((text) => ({ type: 'mrkdwn', text })) },
    ...(!approved && decision.note
      ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Reason*\n> ${esc(decision.note)}` } }]
      : []),
    {
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open your dashboard' }, url: `${appUrl.replace(/\/$/, '')}/` }],
    },
  ];
}

// Messages the rep (found by their sign-in email) once a decision is made, from Slack or the
// Executive Dashboard. Never throws: whether it was sent goes in the change history.
export async function notifyRepInSlack(recordId: string, appUrl: string) {
  if (!process.env.SLACK_BOT_TOKEN) return;
  const quote = await getQuoteById(recordId);
  if (!quote?.ownerEmail) return;
  const blocks = repDecisionBlocks(quote, appUrl);
  if (!blocks) return;
  const system = { name: 'Pricing Calculator' };
  try {
    const found = await slackApi<{ user?: { id?: string } }>('users.lookupByEmail', { email: quote.ownerEmail }, { form: true });
    if (!found.user?.id) throw new Error('users_not_found');
    const approved = quote.status === 'APPROVED';
    await slackApi('chat.postMessage', {
      channel: found.user.id,
      text: `${approved ? 'Approved' : 'Not approved'}: your Deal Review for ${quote.customerName}`,
      blocks,
      unfurl_links: false,
    });
    await recordActivity('slack-sent', quote, system, `Messaged ${quote.ownerEmail} in Slack`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = message.includes('users_not_found') ? `no Slack user has the email ${quote.ownerEmail}` : message;
    console.error('[slack] could not message the rep:', reason);
    await recordActivity('slack-failed', quote, system, `Could not message the rep in Slack: ${reason}`);
  }
}
