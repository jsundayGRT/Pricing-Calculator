import { randomUUID } from 'node:crypto';
import { recordActivity } from './activity';
import { store } from './store';

// 'awaiting-approval': a Deal Review isn't sent to HubSpot until it is approved.
export type HubSpotSyncStatus = 'pending' | 'synced' | 'failed' | 'skipped' | 'awaiting-approval';

// What the HubSpot sync knows about a request. Only IDs and links: nothing priced lives here.
export type HubSpotSync = {
  dealId: string | null;
  dealName: string | null;
  status: HubSpotSyncStatus;
  quoteId?: string | null;
  quoteUrl?: string | null;
  fileId?: string | null;
  noteId?: string | null;
  lineItemIds?: string[];
  error?: string | null;
  attempts?: number;
  lastAttemptAt?: string | null;
  syncedAt?: string | null;
};

export type QuoteRecord = {
  id: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  requestId: string;
  version: number;
  customerName: string;
  status: string;
  stage?: string | null;
  lockedAt: string;
  finalPrice?: number | null;
  currency?: string | null;
  snapshot: Record<string, unknown>;
  hubspot?: HubSpotSync | null;
  // The Deal Review message posted to Slack, so it can be updated once someone decides.
  slack?: { channel: string; ts: string } | null;
  createdAt: string;
  updatedAt: string;
};

// The customer quote PDF the calculator built at lock time, kept so the HubSpot sync (and a
// retry) can upload the same file the rep downloads.
export async function saveQuotePdf(id: string, bytes: Uint8Array) {
  await store().putPdf(id, bytes);
}

export async function readQuotePdf(id: string): Promise<Uint8Array | null> {
  return store().getPdf(id);
}

const byLockedDesc = (a: QuoteRecord, b: QuoteRecord) => String(b.lockedAt).localeCompare(String(a.lockedAt));

export async function listQuotesForUser(ownerId: string) {
  return (await store().all<QuoteRecord>()).filter((q) => q.ownerId === ownerId).sort(byLockedDesc);
}

export async function listAllQuotes() {
  return (await store().all<QuoteRecord>()).sort(byLockedDesc);
}

export async function getQuoteById(id: string) {
  return store().get<QuoteRecord>(id);
}

export async function getQuoteForUser(ownerId: string, id: string) {
  const quote = await getQuoteById(id);
  return quote && quote.ownerId === ownerId ? quote : null;
}

export async function upsertQuote(input: {
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  snapshot: Record<string, unknown>;
}) {
  const snap = input.snapshot;
  const requestId = String(snap.requestId || '');
  const version = Number(snap.version || 1);
  if (!requestId) throw new Error('snapshot.requestId is required');

  const customer = (snap.customer || {}) as Record<string, unknown>;
  const fx = (customer.fx || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  const existing = (await store().all<QuoteRecord>()).find(
    (q) => q.ownerId === input.ownerId && q.requestId === requestId && q.version === version,
  );

  const deal = (snap.hubspotDeal || {}) as Record<string, unknown>;
  const dealId = deal.id ? String(deal.id) : null;
  const dealName = deal.name ? String(deal.name) : null;
  // Re-saving the same version keeps its HubSpot quote (the sync updates it instead of
  // creating a duplicate) unless the deal changed.
  const hubspot: HubSpotSync | null = existing?.hubspot && existing.hubspot.dealId === dealId
    ? { ...existing.hubspot, dealName }
    : dealId ? { dealId, dealName, status: snap.status === 'DEAL REVIEW' ? 'awaiting-approval' : 'pending' } : null;

  const record: QuoteRecord = {
    id: existing?.id || randomUUID(),
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    requestId,
    version,
    customerName: String(snap.customerName || 'Untitled'),
    status: String(snap.status || 'Standard'),
    stage: snap.stage == null ? null : String(snap.stage),
    lockedAt: String(snap.lockedAt || now),
    finalPrice: typeof customer.finalPrice === 'number' ? customer.finalPrice : null,
    currency: typeof fx.currency === 'string' ? fx.currency : 'USD',
    snapshot: snap,
    hubspot,
    slack: existing?.slack ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await store().put(record);
  if (!existing) {
    await recordActivity('locked', record, { name: input.ownerName, email: input.ownerEmail },
      record.status === 'DEAL REVIEW' ? 'Sent to Deal Review' : 'Standard pricing');
  }
  return record;
}

type LogEntry = {
  at: string;
  by: string;
  email: string;
  action: 'approved' | 'not-approved' | 'note';
  note?: string;
};

function withLog(snapshot: Record<string, unknown>, entry: LogEntry) {
  const prev = Array.isArray(snapshot.log) ? snapshot.log : [];
  return { ...snapshot, log: [entry, ...prev].slice(0, 50) };
}

export async function approveQuote(id: string, approver: { name: string; email: string }, note?: string) {
  return decideQuote(id, approver, 'approve', note);
}

export async function declineQuote(id: string, approver: { name: string; email: string }, note?: string) {
  return decideQuote(id, approver, 'decline', note);
}

export type Decision = { outcome: 'approved' | 'not-approved'; by: string; at: string; note: string };

// Who approved or declined a request, when, and the note they left (the reason, for a decline).
export function decisionOf(quote: QuoteRecord): Decision | null {
  if (quote.status !== 'APPROVED' && quote.status !== 'NOT APPROVED') return null;
  const snap = quote.snapshot as {
    approval?: { by?: string; at?: string; note?: string };
    decision?: { by?: string; at?: string; note?: string };
    log?: { action?: string; note?: string }[];
  };
  const approved = quote.status === 'APPROVED';
  const d = approved ? snap.approval : snap.decision;
  // Decisions made before the note was kept on the decision itself: use the latest log entry.
  const logged = (snap.log || []).find((e) => e.action === (approved ? 'approved' : 'not-approved'));
  return {
    outcome: approved ? 'approved' : 'not-approved',
    by: d?.by || 'someone',
    at: d?.at || '',
    note: d?.note ?? logged?.note ?? '',
  };
}

export async function addQuoteLog(id: string, approver: { name: string; email: string }, note: string) {
  const text = note.trim();
  if (!text) return null;
  const quote = await getQuoteById(id);
  if (!quote) return null;
  const now = new Date().toISOString();
  quote.snapshot = withLog(quote.snapshot, {
    at: now,
    by: approver.name || approver.email,
    email: approver.email,
    action: 'note',
    note: text,
  });
  quote.updatedAt = now;
  await store().put(quote);
  await recordActivity('note', quote, approver, text);
  return quote;
}

async function decideQuote(
  id: string,
  approver: { name: string; email: string },
  action: 'approve' | 'decline',
  note?: string,
) {
  const quote = await getQuoteById(id);
  if (!quote) return null;
  const now = new Date().toISOString();
  const by = approver.name || approver.email;
  const text = note?.trim() || '';
  const decision = {
    by,
    email: approver.email,
    at: now.slice(0, 10),
    outcome: action === 'approve' ? 'approved' : 'not-approved',
    ...(text ? { note: text } : {}),
  };
  const entry: LogEntry = {
    at: now,
    by,
    email: approver.email,
    action: action === 'approve' ? 'approved' : 'not-approved',
    ...(text ? { note: text } : {}),
  };
  if (action === 'approve') {
    quote.snapshot = withLog({ ...quote.snapshot, approval: decision, status: 'APPROVED' }, entry);
    quote.status = 'APPROVED';
  } else {
    const { approval: _removed, ...rest } = quote.snapshot;
    void _removed;
    quote.snapshot = withLog({ ...rest, decision, status: 'NOT APPROVED' }, entry);
    quote.status = 'NOT APPROVED';
  }
  quote.updatedAt = now;
  await store().put(quote);
  await recordActivity(action === 'approve' ? 'approved' : 'declined', quote, approver, text);
  return quote;
}

// Re-reads the record right before writing so a background sync doesn't undo a decision
// made in the meantime.
export async function updateQuoteHubSpot(id: string, patch: Partial<HubSpotSync>) {
  const quote = await getQuoteById(id);
  if (!quote) return null;
  const prev: HubSpotSync = quote.hubspot || { dealId: null, dealName: null, status: 'pending' };
  quote.hubspot = { ...prev, ...patch };
  quote.updatedAt = new Date().toISOString();
  await store().put(quote);
  return quote;
}

export async function setQuoteSlack(id: string, slack: { channel: string; ts: string }) {
  const quote = await getQuoteById(id);
  if (!quote) return null;
  quote.slack = slack;
  await store().put(quote);
  return quote;
}

export async function deleteQuoteForUser(ownerId: string, id: string) {
  const quote = await getQuoteForUser(ownerId, id);
  if (!quote) return false;
  await store().remove(id);
  await store().removePdf(id);
  await recordActivity('deleted', quote, { name: quote.ownerName, email: quote.ownerEmail }, 'Removed from the dashboard');
  return true;
}
