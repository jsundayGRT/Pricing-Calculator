// The change history: who locked, approved, declined, noted or removed a request, and whether
// the rep was told about a decision (in Slack, or by email). Newest first, for the Executive Dashboard.

import { store } from './store';

export type ActivityType =
  | 'locked' | 'approved' | 'declined' | 'note' | 'deleted'
  | 'slack-sent' | 'slack-failed' | 'emailed' | 'email-failed';

export type ActivityEvent = {
  at: string;
  type: ActivityType;
  by: string;
  email?: string;
  quoteId: string;
  requestId: string;
  version: number;
  customerName: string;
  detail?: string;
};

type QuoteRef = { id: string; requestId: string; version: number; customerName: string };

export async function recordActivity(
  type: ActivityType,
  quote: QuoteRef,
  actor: { name?: string; email?: string },
  detail?: string,
) {
  const event: ActivityEvent = {
    at: new Date().toISOString(),
    type,
    by: actor.name || actor.email || 'someone',
    ...(actor.email ? { email: actor.email } : {}),
    quoteId: quote.id,
    requestId: quote.requestId,
    version: quote.version,
    customerName: quote.customerName,
    ...(detail ? { detail } : {}),
  };
  // The log never blocks the action it records.
  try {
    await store().addEvent(event);
  } catch (err) {
    console.error('[activity] could not record', type, err);
  }
  return event;
}

export async function listActivity(filter?: { requestId?: string }) {
  const all = await store().events<ActivityEvent>();
  return filter?.requestId ? all.filter((e) => e.requestId === filter.requestId) : all;
}
