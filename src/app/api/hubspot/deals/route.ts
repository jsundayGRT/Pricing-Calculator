import { NextResponse } from 'next/server';
import { hubspotEnabled } from '@/lib/hubspot/client';
import { searchDeals } from '@/lib/hubspot/deals';
import { readSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!hubspotEnabled()) return NextResponse.json({ error: 'HubSpot is not configured' }, { status: 503 });

  const q = new URL(request.url).searchParams.get('q') || '';
  try {
    return NextResponse.json({ deals: await searchDeals(q) });
  } catch (err) {
    console.error('[hubspot] deal search failed:', err);
    return NextResponse.json({ error: 'Could not search HubSpot deals' }, { status: 502 });
  }
}
