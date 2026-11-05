import { after, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { syncRequestToHubSpot } from '@/lib/hubspot/sync';
import { addQuoteLog, approveQuote, declineQuote, getQuoteById } from '@/lib/quotes';
import { summarizeForExec } from '@/lib/quote-view';
import { readSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await params;
  const quote = getQuoteById(id);
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    summary: summarizeForExec(quote),
    quote,
  });
}

export async function POST(request: Request, { params }: Params) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const actor = { name: session.name, email: session.email };
  const { id } = await params;
  if (body?.action === 'retry-sync') {
    const existing = getQuoteById(id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!existing.hubspot?.dealId) return NextResponse.json({ error: 'no HubSpot deal on this request' }, { status: 400 });
    await syncRequestToHubSpot(id);
    const quote = getQuoteById(id)!;
    return NextResponse.json({ summary: summarizeForExec(quote), quote });
  }
  const note = typeof body?.note === 'string' ? body.note : '';
  const quote = body?.action === 'approve'
    ? approveQuote(id, actor, note)
    : body?.action === 'decline'
      ? declineQuote(id, actor, note)
      : body?.action === 'log'
        ? addQuoteLog(id, actor, note)
        : null;
  if (body?.action !== 'approve' && body?.action !== 'decline' && body?.action !== 'log') {
    return NextResponse.json({ error: 'unsupported action' }, { status: 400 });
  }
  if (body?.action === 'log' && !note.trim()) {
    return NextResponse.json({ error: 'note required' }, { status: 400 });
  }
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // Approval updates the HubSpot quote (same quote, not a new one), after the response.
  if (body?.action === 'approve' && quote.hubspot?.dealId) after(() => syncRequestToHubSpot(quote.id));

  return NextResponse.json({
    summary: summarizeForExec(quote),
    quote,
  });
}
