import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { hubspotEnabled } from '@/lib/hubspot/client';
import { dealsForOwnerEmail, searchDeals } from '@/lib/hubspot/deals';
import { readSession } from '@/lib/session';

// GET            → the signed-in person's open deals (matched to their HubSpot owner by email)
// GET ?q=<name>  → search every deal in the pipeline (admins only)
export async function GET(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!hubspotEnabled()) return NextResponse.json({ error: 'HubSpot is not configured' }, { status: 503 });

  const admin = isAdmin(session);
  const q = new URL(request.url).searchParams.get('q');
  try {
    if (q !== null) {
      if (!admin) return NextResponse.json({ error: 'Only admins can search all deals' }, { status: 403 });
      return NextResponse.json({ deals: await searchDeals(q), admin });
    }
    const mine = await dealsForOwnerEmail(session.email);
    if (mine.status === 'owners-unavailable') console.error('[hubspot] the HubSpot key cannot read owners (needs crm.objects.owners.read)');
    return NextResponse.json({ ...mine, admin });
  } catch (err) {
    console.error('[hubspot] deal lookup failed:', err);
    return NextResponse.json({ error: 'Could not load HubSpot deals' }, { status: 502 });
  }
}
