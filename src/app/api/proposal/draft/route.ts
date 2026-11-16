import { NextResponse } from 'next/server';
import { buildProposal, draftFileName } from '@/lib/proposal';
import type { QuoteRecord } from '@/lib/quotes';
import { readSession } from '@/lib/session';

// A draft proposal: the calculator's current estimate in Guardrail's Word template, marked as a
// draft that hasn't been reviewed. Nothing is saved; the proposal to send comes after approval.
export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { snapshot?: Record<string, unknown> } | null;
  const snap = body?.snapshot;
  if (!snap || typeof snap !== 'object' || !snap.customer || typeof snap.customer !== 'object') {
    return NextResponse.json({ error: 'No pricing to put in the proposal.' }, { status: 400 });
  }
  const customerName = String(snap.customerName || '').trim().slice(0, 200) || 'Estimate';
  const now = new Date();
  const record: QuoteRecord = {
    id: 'draft', ownerId: session.id, ownerEmail: session.email, ownerName: session.name,
    requestId: 'DRAFT', version: 1, customerName, status: 'DRAFT', lockedAt: now.toISOString(),
    snapshot: { ...snap, customerName, rep: String(snap.rep || '').slice(0, 100), lockedAt: now.toISOString() },
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  try {
    const docx = buildProposal(record, { draft: true, now });
    return new NextResponse(new Uint8Array(docx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(draftFileName(customerName, now))}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[proposal] could not build a draft', err);
    return NextResponse.json({ error: 'The draft proposal could not be built.' }, { status: 500 });
  }
}
