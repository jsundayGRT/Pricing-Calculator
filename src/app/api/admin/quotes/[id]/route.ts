import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { approveQuote, getQuoteById } from '@/lib/quotes';
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
  if (body?.action !== 'approve') return NextResponse.json({ error: 'unsupported action' }, { status: 400 });

  const { id } = await params;
  const quote = approveQuote(id, { name: session.name, email: session.email });
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({
    summary: summarizeForExec(quote),
    quote,
  });
}
