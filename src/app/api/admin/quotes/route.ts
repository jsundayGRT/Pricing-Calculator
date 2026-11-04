import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { listAllQuotes } from '@/lib/quotes';
import { sortExecQuotes, summarizeForExec } from '@/lib/quote-view';
import { readSession } from '@/lib/session';

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const quotes = sortExecQuotes(listAllQuotes().map(summarizeForExec));
  return NextResponse.json({ quotes });
}
