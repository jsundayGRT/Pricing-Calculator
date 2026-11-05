import { after, NextResponse } from 'next/server';
import { syncRequestToHubSpot } from '@/lib/hubspot/sync';
import { approveQuote, declineQuote, getQuoteById } from '@/lib/quotes';
import {
  APPROVE_ACTION,
  DECLINE_ACTION,
  refreshDealReviewMessage,
  slackUser,
  verifySlackSignature,
} from '@/lib/slack';

// Slack's Interactivity Request URL: called when someone clicks Approve or Decline on a Deal
// Review message. Anyone in the channel may decide; Slack's signature proves the click is real.
type BlockActions = {
  type?: string;
  user?: { id: string; name?: string; username?: string };
  actions?: { action_id: string; value?: string }[];
  response_url?: string;
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers.get('x-slack-request-timestamp'), request.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }

  let payload: BlockActions;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get('payload') || '{}');
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }
  const action = payload.actions?.[0];
  if (payload.type !== 'block_actions' || !action?.value || !payload.user) return new NextResponse(null, { status: 200 });
  if (action.action_id !== APPROVE_ACTION && action.action_id !== DECLINE_ACTION) return new NextResponse(null, { status: 200 });

  const appUrl = new URL(request.url).origin;
  const quote = await getQuoteById(action.value);
  if (!quote) {
    await reply(payload.response_url, 'That pricing request no longer exists in the calculator.');
    return new NextResponse(null, { status: 200 });
  }
  if (quote.status !== 'DEAL REVIEW') {
    // Someone decided first (here or on the Executive Dashboard): just bring the message up to date.
    after(() => refreshDealReviewMessage(quote.id, appUrl));
    await reply(payload.response_url, `This request was already ${quote.status === 'APPROVED' ? 'approved' : 'declined'}.`);
    return new NextResponse(null, { status: 200 });
  }

  const who = await slackUser(payload.user.id, payload.user.name || payload.user.username || 'Slack user');
  const decided = action.action_id === APPROVE_ACTION
    ? await approveQuote(quote.id, who, 'Approved in Slack')
    : await declineQuote(quote.id, who, 'Declined in Slack');

  after(async () => {
    await refreshDealReviewMessage(quote.id, appUrl);
    // Approval updates the HubSpot quote, same as approving on the Executive Dashboard.
    if (action.action_id === APPROVE_ACTION && decided?.hubspot?.dealId) await syncRequestToHubSpot(quote.id);
  });
  return new NextResponse(null, { status: 200 });
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
