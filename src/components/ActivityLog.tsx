'use client';

import type { ActivityEvent, ActivityType } from '@/lib/activity';

// The change history, as a list. Used for one request (in the Executive Dashboard drawer) and for
// every request (the Activity view).

const LABELS: Record<ActivityType, string> = {
  locked: 'Locked',
  approved: 'Approved',
  declined: 'Not approved',
  note: 'Note',
  deleted: 'Removed',
  'slack-sent': 'Rep messaged in Slack',
  'slack-failed': 'Slack message not sent',
  emailed: 'Rep emailed',
  'email-failed': 'Email not sent',
};

const TONE: Partial<Record<ActivityType, string>> = {
  approved: 'ok',
  emailed: 'ok',
  'slack-sent': 'ok',
  'slack-failed': 'bad',
  declined: 'bad',
  deleted: 'bad',
  'email-failed': 'bad',
};

type LogEntry = { at?: string; by?: string; action?: string; note?: string };

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Requests decided before the change history existed only have the log kept on the request
// itself: merge it in, skipping entries the history already has.
export function mergeHistory(events: ActivityEvent[], log: LogEntry[], ref: Omit<ActivityEvent, 'at' | 'type' | 'by'>) {
  const typeOf = (action?: string): ActivityType =>
    action === 'approved' ? 'approved' : action === 'not-approved' ? 'declined' : 'note';
  const extra = log
    .filter((e) => e.at)
    .map((e) => ({ ...ref, at: e.at!, type: typeOf(e.action), by: e.by || 'someone', ...(e.note ? { detail: e.note } : {}) }))
    .filter((e) => !events.some((x) => x.type === e.type && Math.abs(Date.parse(x.at) - Date.parse(e.at)) < 60_000));
  return [...events, ...extra].sort((a, b) => b.at.localeCompare(a.at));
}

export function ActivityList({ events, showRequest = false }: { events: ActivityEvent[]; showRequest?: boolean }) {
  if (!events.length) return <p className="sub" style={{ marginTop: 12 }}>No activity yet.</p>;
  return (
    <ol className="log-list activity">
      {events.map((e, i) => (
        <li key={`${e.at}-${e.type}-${i}`}>
          <strong className={TONE[e.type] ? `tone-${TONE[e.type]}` : undefined}>{LABELS[e.type] || e.type}</strong>
          {showRequest
            ? <span> · <b>{e.customerName}</b> <span className="quote-meta">{e.requestId}{e.version > 1 ? ` v${e.version}` : ''}</span></span>
            : e.type === 'locked' ? <span> · version {e.version}</span> : null}
          <span className="quote-meta"> · {e.by} · {fmtDate(e.at)}</span>
          {e.detail ? <p>{e.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
