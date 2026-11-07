import { after, NextResponse } from 'next/server';
import { syncRequestToHubSpot } from '@/lib/hubspot/sync';
import { quoteExpiry } from '@/lib/expiry';
import { decisionOf, listQuotesForUser, saveQuotePdf, upsertQuote } from '@/lib/quotes';
import { readSession } from '@/lib/session';
import { postDealReview } from '@/lib/slack';

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const quotes = (await listQuotesForUser(session.id)).map((quote) => {
    const { snapshot: _ignored, ...rest } = quote;
    void _ignored;
    // Who approved or declined it, and why: the rep sees this on their dashboard.
    return { ...rest, decision: decisionOf(quote), expiresAt: quoteExpiry(quote) };
  });
  return NextResponse.json({ quotes });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  try {
    const body = await request.json();
    const snapshot = (body?.snapshot || body) as Record<string, unknown>;
    if (!snapshot || typeof snapshot !== 'object') {
      return NextResponse.json({ error: 'snapshot required' }, { status: 400 });
    }
    const record = await upsertQuote({
      ownerId: session.id,
      ownerEmail: session.email,
      ownerName: session.name,
      snapshot,
    });
    // The calculator sends the customer quote PDF it built, for the HubSpot sync to upload.
    const pdf = decodePdf(body?.pdf);
    if (pdf) await saveQuotePdf(record.id, pdf);
    // Sync after the response: a HubSpot or Slack problem never blocks the lock. A Deal Review
    // waits for approval before anything goes to HubSpot.
    if (record.hubspot?.dealId && record.status !== 'DEAL REVIEW') after(() => syncRequestToHubSpot(record.id));
    if (record.status === 'DEAL REVIEW' && !record.slack) {
      const appUrl = new URL(request.url).origin;
      after(() => postDealReview(record.id, appUrl));
    }
    const { snapshot: _ignored, ...summary } = record;
    void _ignored;
    return NextResponse.json({ quote: summary }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to save quote';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const MAX_PDF_BYTES = 5 * 1024 * 1024;

function decodePdf(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  return bytes;
}
