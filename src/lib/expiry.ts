import type { QuoteRecord } from './quotes';

const DAY = 86_400_000;
export const DEFAULT_VALID_DAYS = 30;

// When a quote's prices stop being valid: the date the rep picked when locking (past the
// standard validity it needed a Deal Review). Requests locked before the date picker count the
// days in the price list ("Quote valid for (days)"): a Standard request from when it was locked,
// a Deal Review from when it was approved. A Deal Review still waiting, or declined, has no expiry.
export function quoteExpiry(quote: Pick<QuoteRecord, 'status' | 'lockedAt' | 'snapshot'>): string | null {
  const snap = (quote.snapshot || {}) as {
    customer?: { quoteValidDays?: unknown; validUntil?: unknown };
    approval?: { at?: string };
  };
  if (quote.status === 'DEAL REVIEW' || quote.status === 'NOT APPROVED') return null;
  const picked = snap.customer?.validUntil;
  // a calendar day: midday UTC keeps it on that day in any time zone
  if (typeof picked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(picked)) return `${picked}T12:00:00.000Z`;
  const raw = Number(snap.customer?.quoteValidDays);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VALID_DAYS;

  let start: number;
  if (quote.status === 'APPROVED') {
    // approvals are kept as a calendar day (YYYY-MM-DD): count from midday so no time zone
    // moves it to another day
    const day = snap.approval?.at;
    start = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T12:00:00Z`) : Date.parse(quote.lockedAt);
  } else if (quote.status === 'DEAL REVIEW' || quote.status === 'NOT APPROVED') {
    return null;
  } else {
    start = Date.parse(quote.lockedAt);
  }
  return Number.isFinite(start) ? new Date(start + days * DAY).toISOString() : null;
}

// Whole days left until it expires (negative once it has), counted in calendar days.
export function daysLeft(expiresAt: string, now = new Date()) {
  const end = new Date(expiresAt);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / DAY);
}

// Soon = within a week.
export const EXPIRES_SOON_DAYS = 7;
