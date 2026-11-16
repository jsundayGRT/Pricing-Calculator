import { after, NextResponse } from 'next/server';
import { hubspotSyncOn } from '@/lib/hubspot/client';
import { syncRequestToHubSpot } from '@/lib/hubspot/sync';
import { quoteExpiry } from '@/lib/expiry';
import { isWordFile } from '@/lib/proposal';
import { decisionOf, listQuotesForUser, saveProposalUpload, upsertQuote, type QuoteRecord } from '@/lib/quotes';
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
    // The rep's edited proposal, when they attached one: what reviewers read and approve.
    const proposal = decodeDocx(body?.proposal);
    let saved = record;
    if (proposal) saved = (await saveProposalUpload(record.id, proposal, { name: String(body?.proposalName || 'proposal.docx'), by: session.name || session.email })) || record;
    const proposalError = !proposal && body?.proposal ? 'The attached proposal is not a Word document (.docx) under 3 MB.' : undefined;
    // Sync after the response: a HubSpot or Slack problem never blocks the lock. A Deal Review
    // waits for approval before anything goes to HubSpot.
    if (hubspotSyncOn() && record.hubspot?.dealId && record.status !== 'DEAL REVIEW') after(() => syncRequestToHubSpot(record.id));
    if (record.status === 'DEAL REVIEW' && !record.slack) {
      const appUrl = new URL(request.url).origin;
      after(() => postDealReview(record.id, appUrl));
    }
    return NextResponse.json({ quote: summaryOf(saved), proposalError }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to save quote';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function summaryOf(record: QuoteRecord) {
  const { snapshot: _ignored, ...summary } = record;
  void _ignored;
  return summary;
}

const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;

function decodeDocx(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length <= MAX_PROPOSAL_BYTES && isWordFile(bytes) ? bytes : null;
}

