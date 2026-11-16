import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';
import { buildProposal, proposalFileName } from '@/lib/proposal';
import { getQuoteById } from '@/lib/quotes';
import { readSession } from '@/lib/session';

// The customer proposal (Word) for a locked request. Reviewers (admins) can open it while they
// review; the rep gets it once the request is approved.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });

  const { id } = await params;
  const quote = await getQuoteById(id);
  const admin = await isAdmin(session);
  if (!quote || (!admin && quote.ownerId !== session.id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!admin && quote.status !== 'APPROVED' && quote.status !== 'STANDARD') {
    return NextResponse.json({ error: 'The proposal is ready once the request is approved.' }, { status: 403 });
  }

  try {
    const docx = buildProposal(quote);
    return new NextResponse(new Uint8Array(docx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(proposalFileName(quote))}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[proposal] could not build', quote.requestId, err);
    return NextResponse.json({ error: 'The proposal could not be built.' }, { status: 500 });
  }
}
