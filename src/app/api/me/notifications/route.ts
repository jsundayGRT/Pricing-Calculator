import { NextResponse } from 'next/server';
import { notifyAvailable, notifyPrefsFor, setNotifyPrefs } from '@/lib/notify';
import { readSession } from '@/lib/session';

// GET  → how the signed-in person hears about Deal Review decisions, and what is set up
// POST { email?: boolean, slack?: boolean } → change it
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  return NextResponse.json({ prefs: await notifyPrefsFor(session.email), available: notifyAvailable() });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  try {
    const body = await request.json();
    const prefs = await setNotifyPrefs(session.email, { email: body?.email, slack: body?.slack });
    return NextResponse.json({ prefs, available: notifyAvailable() });
  } catch (err) {
    console.error('[notify] could not save choices', err);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}
