import { NextResponse } from 'next/server';
import { recordActivity } from '@/lib/activity';
import { isAdmin } from '@/lib/admin';
import { docxToHtml } from '@/lib/docx-html';
import { buildProposal, isWordFile, proposalFileName, withoutDraftNote } from '@/lib/proposal';
import { getQuoteById, readProposalUpload, removeProposalUpload, saveProposalUpload, type QuoteRecord } from '@/lib/quotes';
import { readSession, type SessionUser } from '@/lib/session';

// The customer proposal (Word) for a locked request: the rep's own edit when they attached one,
// otherwise the one built from Guardrail's template.
//   GET                  the Word file. Reviewers (admins) can open it while they review; the
//                        rep gets it once the request is approved.
//   GET ?format=html     a preview in the browser, for the rep and reviewers at any time.
//   PUT (the .docx)      attach the rep's edited proposal while the request is in review.
//   DELETE               go back to the proposal built from the template.

const MAX_PROPOSAL_BYTES = 3 * 1024 * 1024;
const approved = (q: QuoteRecord) => q.status === 'APPROVED' || q.status === 'STANDARD';

async function load(params: Promise<{ id: string }>) {
  const session = await readSession();
  if (!session) return { error: NextResponse.json({ error: 'signed out' }, { status: 401 }) } as const;
  const { id } = await params;
  const quote = await getQuoteById(id);
  const admin = await isAdmin(session);
  if (!quote || (!admin && quote.ownerId !== session.id)) return { error: NextResponse.json({ error: 'not found' }, { status: 404 }) } as const;
  return { session, quote, admin } as const;
}

async function proposalOf(quote: QuoteRecord) {
  const upload = quote.proposalUpload ? await readProposalUpload(quote.id) : null;
  // until it's approved, the proposal is a draft and says so
  if (upload) return { docx: approved(quote) ? withoutDraftNote(upload) : upload, edited: true };
  return { docx: buildProposal(quote, { draft: !approved(quote) }), edited: false };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await load(params);
  if ('error' in r) return r.error;
  const { quote, admin } = r;
  const html = new URL(request.url).searchParams.get('format') === 'html';
  if (!html && !admin && !approved(quote)) {
    return NextResponse.json({ error: 'The proposal is ready once the request is approved.' }, { status: 403 });
  }

  try {
    const { docx, edited } = await proposalOf(quote);
    if (html) {
      const note = [edited ? `Edited by ${quote.proposalUpload?.by || 'the rep'}` : 'Built from the Guardrail template', approved(quote) ? 'Approved' : 'In review'].join(' · ');
      return new NextResponse(docxToHtml(docx, { title: `${quote.customerName} · ${quote.requestId}${quote.version > 1 ? ` v${quote.version}` : ''}`, note }), {
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
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(proposalFileName(quote))}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[proposal] could not build', quote.requestId, err);
    return NextResponse.json({ error: 'The proposal could not be built.' }, { status: 500 });
  }
}

function canChange(session: SessionUser, quote: QuoteRecord, admin: boolean) {
  // the rep changes it while it's in review; reviewers can at any time
  return admin || (quote.ownerId === session.id && quote.status === 'DEAL REVIEW');
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await load(params);
  if ('error' in r) return r.error;
  const { session, quote, admin } = r;
  if (!canChange(session, quote, admin)) {
    return NextResponse.json({ error: 'The proposal can be changed only while the request is in review.' }, { status: 409 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_PROPOSAL_BYTES) return NextResponse.json({ error: 'The file is over 3 MB.' }, { status: 413 });
  if (!isWordFile(bytes)) return NextResponse.json({ error: 'Attach a Word document (.docx).' }, { status: 400 });
  const name = (request.headers.get('X-File-Name') ? decodeURIComponent(request.headers.get('X-File-Name')!) : 'proposal.docx').replace(/[\r\n]/g, ' ');
  const saved = await saveProposalUpload(quote.id, bytes, { name, by: session.name || session.email });
  if (!saved) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await recordActivity('note', saved, { name: session.name, email: session.email }, `Attached an edited proposal (${saved.proposalUpload!.name})`);
  return NextResponse.json({ proposalUpload: saved.proposalUpload });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await load(params);
  if ('error' in r) return r.error;
  const { session, quote, admin } = r;
  if (!canChange(session, quote, admin)) {
    return NextResponse.json({ error: 'The proposal can be changed only while the request is in review.' }, { status: 409 });
  }
  const saved = await removeProposalUpload(quote.id);
  if (saved && quote.proposalUpload) await recordActivity('note', saved, { name: session.name, email: session.email }, 'Removed the edited proposal; the template version is used');
  return NextResponse.json({ ok: true });
}
