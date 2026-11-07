import { quoteExpiry } from './expiry';
import type { QuoteRecord } from './quotes';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function positive(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export type ExecQuoteSummary = {
  id: string;
  requestId: string;
  version: number;
  lockedAt: string;
  rep: string;
  ownerEmail: string;
  customerName: string;
  status: string;
  stage: string | null;
  band: string | null;
  seats: number | null;
  location: string | null;
  modules: string[];
  term: string | null;
  discountRequestedPct: number | null;
  discountAppliedPct: number | null;
  finalPrice: number | null;
  year1Due: number | null;
  currency: string | null;
  dealNote: string | null;
  reviewReason: string | null;
  finalMarginPct: number | null;
  regionalTargetPct: number | null;
  gapToTargetPts: number | null;
  costToServe: number | null;
  // Year 1 price in US dollars at the request's exchange rate, so reports can add them up.
  finalPriceUsd: number | null;
  // When it was approved or declined (the full time, from the request's history).
  decidedAt: string | null;
  expiresAt: string | null;
};

export function summarizeForExec(quote: QuoteRecord): ExecQuoteSummary {
  const snap = quote.snapshot || {};
  const inputs = (snap.inputs || {}) as Record<string, unknown>;
  const customer = (snap.customer || {}) as Record<string, unknown>;
  const internal = (snap.internal || {}) as Record<string, unknown>;
  const costs = (internal.costs || {}) as Record<string, unknown>;
  const fx = (customer.fx || {}) as Record<string, unknown>;
  const included = (customer.included || {}) as Record<string, unknown>;
  const modulesObj = (inputs.modules || {}) as Record<string, unknown>;
  const finalPrice = quote.finalPrice ?? num(customer.finalPrice);
  const rate = num(fx.rate);
  const log = Array.isArray(snap.log) ? (snap.log as { action?: string; at?: string }[]) : [];
  const decided = log.find((e) => e.action === 'approved' || e.action === 'not-approved');
  const modules = Object.entries(modulesObj)
    .filter(([, on]) => !!on)
    .map(([k]) => k);

  return {
    id: quote.id,
    requestId: quote.requestId,
    version: quote.version,
    lockedAt: quote.lockedAt,
    rep: str(snap.rep) || quote.ownerName || quote.ownerEmail,
    ownerEmail: quote.ownerEmail,
    customerName: quote.customerName,
    status: quote.status,
    stage: quote.stage || null,
    band: str(inputs.band),
    // Only Enterprise prices by an entered seat count; other bands store 0 there and keep the
    // employee count the rep typed (optional) under customer.included.
    seats: positive(inputs.seats)
      ?? positive(included.customerEmployees)
      ?? positive(included.governedEmployees),
    location: str(inputs.location),
    modules,
    term: str(inputs.term),
    // Engine stores requested/applied as fractions (0.15 = 15%). Inputs use whole percents.
    discountRequestedPct: num(internal.requestedVariableDiscountPct)
      ?? (num(inputs.variableDiscountPct) != null ? num(inputs.variableDiscountPct)! / 100 : null),
    discountAppliedPct: num(internal.appliedVariableDiscountPct),
    finalPrice,
    year1Due: num(customer.year1DueAtSigning),
    currency: quote.currency || str(fx.currency) || 'USD',
    dealNote: str(customer.dealNote),
    reviewReason: str(internal.reviewReason),
    finalMarginPct: num(internal.finalMarginPct),
    regionalTargetPct: num(internal.regionalTargetPct),
    gapToTargetPts: num(internal.gapToTargetPts),
    costToServe: num(costs.totalCostToServe) ?? num(costs.annualCostToServe),
    finalPriceUsd: finalPrice == null ? null : rate && rate > 0 ? finalPrice / rate : finalPrice,
    decidedAt: decided?.at || null,
    expiresAt: quoteExpiry(quote),
  };
}

export function sortExecQuotes(quotes: ExecQuoteSummary[]) {
  return [...quotes].sort((a, b) => {
    const aReview = a.status === 'DEAL REVIEW' ? 0 : 1;
    const bReview = b.status === 'DEAL REVIEW' ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    return String(b.lockedAt).localeCompare(String(a.lockedAt));
  });
}
