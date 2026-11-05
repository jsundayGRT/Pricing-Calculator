import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type HubSpotSyncStatus = 'pending' | 'synced' | 'failed' | 'skipped';

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
  createdAt: string;
  updatedAt: string;
};

type StoreFile = { quotes: QuoteRecord[] };

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return '/tmp';
  return path.join(process.cwd(), 'data');
}

function storePath() {
  if (!process.env.DATA_DIR && process.env.VERCEL) return path.join('/tmp', 'grt-quotes.json');
  return path.join(dataDir(), 'quotes.json');
}

// The customer quote PDF the calculator built at lock time, kept so the HubSpot sync (and a
// retry) can upload the same file the rep downloads.
function pdfPath(id: string) {
  return path.join(dataDir(), 'quote-pdfs', `${id.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`);
}

export function saveQuotePdf(id: string, bytes: Uint8Array) {
  const file = pdfPath(id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

export function readQuotePdf(id: string): Uint8Array | null {
  try {
    return readFileSync(pdfPath(id));
  } catch {
    return null;
  }
}

function emptyStore(): StoreFile {
  return { quotes: [] };
}

function readStore(): StoreFile {
  const file = storePath();
  try {
    if (!existsSync(file)) return emptyStore();
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as StoreFile;
    if (!Array.isArray(parsed.quotes)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StoreFile) {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
}

export function listQuotesForUser(ownerId: string) {
  const store = readStore();
  return store.quotes
    .filter((q) => q.ownerId === ownerId)
    .sort((a, b) => String(b.lockedAt).localeCompare(String(a.lockedAt)));
}

export function listAllQuotes() {
  const store = readStore();
  return [...store.quotes].sort((a, b) => String(b.lockedAt).localeCompare(String(a.lockedAt)));
}

export function getQuoteById(id: string) {
  return listAllQuotes().find((q) => q.id === id) || null;
}

export function getQuoteForUser(ownerId: string, id: string) {
  return listQuotesForUser(ownerId).find((q) => q.id === id) || null;
}

export function upsertQuote(input: {
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
  const store = readStore();

  const existing = store.quotes.find(
    (q) => q.ownerId === input.ownerId && q.requestId === requestId && q.version === version,
  );

  const deal = (snap.hubspotDeal || {}) as Record<string, unknown>;
  const dealId = deal.id ? String(deal.id) : null;
  const dealName = deal.name ? String(deal.name) : null;
  // Re-saving the same version keeps its HubSpot quote (the sync updates it instead of
  // creating a duplicate) unless the deal changed.
  const hubspot: HubSpotSync | null = existing?.hubspot && existing.hubspot.dealId === dealId
    ? { ...existing.hubspot, dealName }
    : dealId ? { dealId, dealName, status: 'pending' } : null;

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
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  store.quotes = [
    record,
    ...store.quotes.filter((q) => !(q.ownerId === input.ownerId && q.requestId === requestId && q.version === version)),
  ];
  writeStore(store);
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

export function approveQuote(id: string, approver: { name: string; email: string }, note?: string) {
  return decideQuote(id, approver, 'approve', note);
}

export function declineQuote(id: string, approver: { name: string; email: string }, note?: string) {
  return decideQuote(id, approver, 'decline', note);
}

export function addQuoteLog(id: string, approver: { name: string; email: string }, note: string) {
  const text = note.trim();
  if (!text) return null;
  const store = readStore();
  const quote = store.quotes.find((q) => q.id === id);
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
  writeStore(store);
  return quote;
}

function decideQuote(
  id: string,
  approver: { name: string; email: string },
  action: 'approve' | 'decline',
  note?: string,
) {
  const store = readStore();
  const quote = store.quotes.find((q) => q.id === id);
  if (!quote) return null;
  const now = new Date().toISOString();
  const by = approver.name || approver.email;
  const text = note?.trim() || '';
  const decision = { by, email: approver.email, at: now.slice(0, 10), outcome: action === 'approve' ? 'approved' : 'not-approved' };
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
  writeStore(store);
  return quote;
}

export function updateQuoteHubSpot(id: string, patch: Partial<HubSpotSync>) {
  const store = readStore();
  const quote = store.quotes.find((q) => q.id === id);
  if (!quote) return null;
  const prev: HubSpotSync = quote.hubspot || { dealId: null, dealName: null, status: 'pending' };
  quote.hubspot = { ...prev, ...patch };
  quote.updatedAt = new Date().toISOString();
  writeStore(store);
  return quote;
}

export function deleteQuoteForUser(ownerId: string, id: string) {
  const store = readStore();
  const before = store.quotes.length;
  store.quotes = store.quotes.filter((q) => !(q.ownerId === ownerId && q.id === id));
  if (store.quotes.length === before) return false;
  writeStore(store);
  try { unlinkSync(pdfPath(id)); } catch { /* no PDF saved */ }
  return true;
}
