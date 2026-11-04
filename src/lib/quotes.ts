import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  createdAt: string;
  updatedAt: string;
};

type StoreFile = { quotes: QuoteRecord[] };

function storePath() {
  if (process.env.VERCEL) return path.join('/tmp', 'grt-quotes.json');
  return path.join(process.cwd(), 'data', 'quotes.json');
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

export function deleteQuoteForUser(ownerId: string, id: string) {
  const store = readStore();
  const before = store.quotes.length;
  store.quotes = store.quotes.filter((q) => !(q.ownerId === ownerId && q.id === id));
  if (store.quotes.length === before) return false;
  writeStore(store);
  return true;
}
