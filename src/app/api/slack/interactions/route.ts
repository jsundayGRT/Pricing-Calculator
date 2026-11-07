import { after, NextResponse } from 'next/server';
import { notifyRepOfDecision } from '@/lib/notify';
import { syncRequestToHubSpot } from '@/lib/hubspot/sync';
import { approveQuote, declineQuote, getQuoteById } from '@/lib/quotes';
import {
  APPROVE_ACTION,
  DECLINE_ACTION,
  DECLINE_MODAL,
  declineReason,
  openDeclineModal,
  refreshDealReviewMessage,
  slackUser,
  verifySlackSignature,
} from '@/lib/slack';

// Slack's Interactivity Request URL. Approve decides right away; Decline opens a pop-up asking
// for the reason, and submitting it declines the request. Anyone in the channel may decide;
// Slack's signature proves the click is real.
type SlackUserRef = { id: string; name?: string; username?: string };
type Payload = {
  type?: string;
  user?: SlackUserRef;
  trigger_id?: string;
  actions?: { action_id: string; value?: string }[];
  response_url?: string;
  view?: { callback_id?: string; private_metadata?: string; state?: { values?: Record<string, Record<string, { value?: string | null }>> } };
};

const ok = () => new NextResponse(null, { status: 200 });

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers.get('x-slack-request-timestamp'), request.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get('payload') || '{}');
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }
  if (!payload.user) return ok();
  const appUrl = new URL(request.url).origin;

  // The reason pop-up was submitted.
  if (payload.type === 'view_submission' && payload.view?.callback_id === DECLINE_MODAL) {
    const reason = declineReason(payload.view);
    if (!reason) return NextResponse.json({ response_action: 'errors', errors: { reason: 'Please give a reason.' } });
    const quote = await getQuoteById(payload.view.private_metadata || '');
    if (!quote) return NextResponse.json({ response_action: 'errors', errors: { reason: 'This request no longer exists in the calculator.' } });
    if (quote.status !== 'DEAL REVIEW') {
      after(() => refreshDealReviewMessage(quote.id, appUrl));
      return NextResponse.json({
        response_action: 'errors',
        errors: { reason: `Someone already ${quote.status === 'APPROVED' ? 'approved' : 'declined'} this request.` },
      });
    }
    const who = await slackUser(payload.user.id, payload.user.name || payload.user.username || 'Slack user');
    await declineQuote(quote.id, who, reason);
    after(async () => {
      await refreshDealReviewMessage(quote.id, appUrl);
      await notifyRepOfDecision(quote.id, appUrl);
    });
    return ok(); // closes the pop-up
  }

  const action = payload.actions?.[0];
  if (payload.type !== 'block_actions' || !action?.value) return ok();
  if (action.action_id !== APPROVE_ACTION && action.action_id !== DECLINE_ACTION) return ok();

  const quote = await getQuoteById(action.value);
  if (!quote) {
    await reply(payload.response_url, 'That pricing request no longer exists in the calculator.');
    return ok();
  }
  if (quote.status !== 'DEAL REVIEW') {
    // Someone decided first (here or on the Executive Dashboard): just bring the message up to date.
    after(() => refreshDealReviewMessage(quote.id, appUrl));
    await reply(payload.response_url, `This request was already ${quote.status === 'APPROVED' ? 'approved' : 'declined'}.`);
    return ok();
  }

  if (action.action_id === DECLINE_ACTION) {
    // Slack only accepts a pop-up within 3 seconds of the click, so open it now.
    try {
      if (!payload.trigger_id) throw new Error('no trigger_id');
      await openDeclineModal(payload.trigger_id, quote);
    } catch (err) {
      console.error('[slack] could not open the decline pop-up:', err);
      await reply(payload.response_url, 'Could not open the decline form. Please try again, or decline on the Executive Dashboard.');
    }
    return ok();
  }

  const who = await slackUser(payload.user.id, payload.user.name || payload.user.username || 'Slack user');
  const approved = await approveQuote(quote.id, who, 'Approved in Slack');
  after(async () => {
    await refreshDealReviewMessage(quote.id, appUrl);
    await notifyRepOfDecision(quote.id, appUrl);
    // Approval sends the request to HubSpot, same as approving on the Executive Dashboard.
    if (approved?.hubspot?.dealId) await syncRequestToHubSpot(quote.id);
  });
  return ok();
}

// A message only the clicker sees.
async function reply(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text }),
    });
  } catch {
    /* best effort */
  }
}
