// Emails the rep when their Deal Review is approved or declined. Sent through Microsoft Graph
// from the mailbox in MAIL_FROM, using the same Entra app as sign-in (AZURE_AD_TENANT_ID,
// AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET). The app needs the Microsoft Graph application
// permission Mail.Send with admin consent. Without MAIL_FROM nothing is sent.
//
// EMAIL_DRY_RUN=1 logs the email instead of sending it.

import { recordActivity } from './activity';
import { quoteExpiry } from './expiry';
import { decisionOf, getQuoteById, type QuoteRecord } from './quotes';

export function emailEnabled() {
  return !!process.env.MAIL_FROM?.trim();
}

type FetchFn = typeof fetch;
let fetchOverride: FetchFn | null = null;
// For tests: send Microsoft calls to a fake.
export function setEmailFetchForTests(fn: FetchFn | null) {
  fetchOverride = fn;
  cachedToken = null;
}
const doFetch: FetchFn = (...args) => (fetchOverride ?? fetch)(...args);

let cachedToken: { value: string; expires: number } | null = null;

async function graphToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const tenant = process.env.AZURE_AD_TENANT_ID || '';
  const res = await doFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.AZURE_AD_CLIENT_ID || '',
      client_secret: process.env.AZURE_AD_CLIENT_SECRET || '',
      scope: 'https://graph.microsoft.com/.default',
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split('\n')[0] || res.status}`);
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export type Email = { to: string; subject: string; html: string };

export async function sendEmail(email: Email) {
  const from = process.env.MAIL_FROM!.trim();
  if (process.env.EMAIL_DRY_RUN === '1') {
    console.log('[email] dry run', JSON.stringify({ from, ...email }));
    return;
  }
  const token = await graphToken();
  const res = await doFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: email.subject,
        body: { contentType: 'HTML', content: email.html },
        toRecipients: [{ emailAddress: { address: email.to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new Error(`Microsoft Graph sendMail failed: ${data.error?.code || res.status}${data.error?.message ? ` (${data.error.message})` : ''}`);
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(v: number | null | undefined, currency: string | null | undefined) {
  if (v == null) return '—';
  const pre = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${pre}${Math.round(v).toLocaleString('en-US')}`;
}

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function decisionEmail(quote: QuoteRecord, appUrl: string): Email | null {
  const decision = decisionOf(quote);
  if (!decision) return null;
  const approved = decision.outcome === 'approved';
  const ref = `${quote.requestId}${quote.version > 1 ? ` v${quote.version}` : ''}`;
  const expires = approved ? quoteExpiry(quote) : null;
  const link = `${appUrl.replace(/\/$/, '')}/`;
  const color = approved ? '#007A5A' : '#B42318';
  const rows = [
    ['Customer', esc(quote.customerName)],
    ['Request', esc(ref)],
    ['Year 1 price', esc(money(quote.finalPrice, quote.currency))],
    ...(quote.hubspot?.dealName ? [['HubSpot deal', esc(quote.hubspot.dealName)]] : []),
    [approved ? 'Approved by' : 'Declined by', esc(decision.by)],
    ...(!approved && decision.note ? [['Reason', esc(decision.note)]] : []),
    ...(expires ? [['Quote valid until', esc(longDate(expires))]] : []),
  ];
  const next = approved
    ? 'The quote PDF is ready on your dashboard.'
    : 'Open the request on your dashboard to revise it and lock a new version.';
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
<p style="font-size:16px;margin:0 0 12px"><b style="color:${color}">${approved ? 'Approved' : 'Not approved'}:</b> your Deal Review for ${esc(quote.customerName)}</p>
<table cellpadding="6" style="border-collapse:collapse;margin:0 0 16px">${rows
    .map(([k, v]) => `<tr><td style="color:#6b7280;padding-left:0">${k}</td><td>${v}</td></tr>`)
    .join('')}</table>
<p style="margin:0 0 16px">${next}</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#0B1F3A;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Open your dashboard</a></p>
<p style="color:#6b7280;font-size:12px;margin:0">Sent by the Guardrail Pricing Calculator.</p>
</div>`;
  return {
    to: quote.ownerEmail,
    subject: `${approved ? 'Approved' : 'Not approved'}: Deal Review for ${quote.customerName} (${ref})`,
    html,
  };
}

// Run after a decision (from the Executive Dashboard or Slack). Never throws: a mail problem is
// recorded in the change history instead.
export async function emailDecisionToRep(id: string, appUrl: string) {
  if (!emailEnabled()) return;
  const quote = await getQuoteById(id);
  if (!quote || !quote.ownerEmail) return;
  const email = decisionEmail(quote, appUrl);
  if (!email) return;
  const system = { name: 'Pricing Calculator' };
  try {
    await sendEmail(email);
    await recordActivity('emailed', quote, system, `Emailed ${quote.ownerEmail}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] could not email the rep:', message);
    await recordActivity('email-failed', quote, system, `Could not email ${quote.ownerEmail}: ${message}`);
  }
}
