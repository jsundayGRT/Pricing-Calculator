import { NextResponse } from 'next/server';
import { listQuotesForUser, upsertQuote } from '@/lib/quotes';
import { readSession } from '@/lib/session';

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const quotes = listQuotesForUser(session.id).map((quote) => {
    const { snapshot: _ignored, ...rest } = quote;
    void _ignored;
    return rest;
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
    const record = upsertQuote({
      ownerId: session.id,
      ownerEmail: session.email,
      ownerName: session.name,
      snapshot,
    });
    const { snapshot: _ignored, ...summary } = record;
    void _ignored;
    return NextResponse.json({ quote: summary }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to save quote';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
