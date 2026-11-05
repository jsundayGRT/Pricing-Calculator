import { NextResponse } from 'next/server';
import { deleteQuoteForUser, getQuoteForUser } from '@/lib/quotes';
import { readSession } from '@/lib/session';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const { id } = await params;
  const quote = await getQuoteForUser(session.id, id);
  if (!quote) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ quote });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const { id } = await params;
  const ok = await deleteQuoteForUser(session.id, id);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
