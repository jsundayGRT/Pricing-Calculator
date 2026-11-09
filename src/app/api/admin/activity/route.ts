import { NextResponse } from 'next/server';
import { listActivity } from '@/lib/activity';
import { isAdmin } from '@/lib/admin';
import { readSession } from '@/lib/session';

// The change history across every request, newest first.
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  return NextResponse.json({ events: await listActivity() });
}
