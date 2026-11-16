import { NextResponse } from 'next/server';
import { docxToHtml } from '@/lib/docx-html';
import { buildProposal, DRAFT_NOTE, draftFileName } from '@/lib/proposal';
import { buildProposalPdf } from '@/lib/proposal-pdf';
import type { QuoteRecord } from '@/lib/quotes';
import { readSession } from '@/lib/session';

// A draft proposal: the calculator's current estimate in Guardrail's Word template, marked as a
// draft that hasn't been reviewed. Nothing is saved; the proposal to send comes after approval.
// ?format=html previews it in the browser instead; ?format=pdf is the estimate PDF, in the same design.
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
    if (new URL(request.url).searchParams.get('format') === 'pdf') {
      return new NextResponse(new Uint8Array(buildProposalPdf(record, { note: DRAFT_NOTE, now })), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(draftFileName(customerName, now).replace(/\.docx$/, '.pdf'))}`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    const docx = buildProposal(record, { draft: true, now });
    if (new URL(request.url).searchParams.get('format') === 'html') {
      return new NextResponse(docxToHtml(docx, { title: `${customerName} · draft proposal`, note: 'Not saved or reviewed' }), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
          'Cache-Control': 'private, no-store',
        },
      });
    }
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
