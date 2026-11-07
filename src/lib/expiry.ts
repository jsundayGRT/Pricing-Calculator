import type { QuoteRecord } from './quotes';

const DAY = 86_400_000;
export const DEFAULT_VALID_DAYS = 30;

// When a quote's prices stop being valid. The days come from the price list the request was
// locked with ("Quote valid for (days)" in the calculator settings). A Standard request counts
// from when it was locked; a Deal Review from when it was approved, since that's when the
// customer can have it. A Deal Review still waiting, or declined, has no expiry.
export function quoteExpiry(quote: Pick<QuoteRecord, 'status' | 'lockedAt' | 'snapshot'>): string | null {
  const snap = (quote.snapshot || {}) as {
    customer?: { quoteValidDays?: unknown };
    approval?: { at?: string };
  };
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
