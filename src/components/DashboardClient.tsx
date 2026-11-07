'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Decision, HubSpotSync } from '@/lib/quotes';
import { ExpiryTag } from './ExpiryTag';
import { HubSpotSyncLine } from './HubSpotSyncLine';

type QuoteSummary = {
  id: string;
  requestId: string;
  version: number;
  customerName: string;
  status: string;
  stage?: string | null;
  lockedAt: string;
  finalPrice?: number | null;
  currency?: string | null;
  hubspot?: HubSpotSync | null;
  decision?: Decision | null;
  expiresAt?: string | null;
};

function fmtDay(day: string) {
  // decision dates are calendar days (YYYY-MM-DD); show them without a time-zone shift
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// An approval is a plain line; a decline keeps its box, since the reason is worth reading.
function DecisionLine({ decision }: { decision?: Decision | null }) {
  if (!decision) return null;
  if (decision.outcome === 'approved') {
    return <div className="meta-line">Approved by {decision.by}{decision.at ? ` · ${fmtDay(decision.at)}` : ''}</div>;
  }
  return (
    <div className="decision bad">
      <b>Not approved</b> by {decision.by}
      {decision.at ? ` · ${fmtDay(decision.at)}` : ''}
      {decision.note ? <div className="decision-note">Reason: {decision.note}</div> : null}
    </div>
  );
}

function money(amount?: number | null, currency?: string | null) {
  if (amount == null) return '—';
  const pre = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${pre}${Math.round(amount).toLocaleString('en-US')}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtShort(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Filter = 'all' | 'waiting' | 'ready' | 'declined';
type Sort = 'newest' | 'expiring' | 'price';

const isWaiting = (q: QuoteSummary) => q.status === 'DEAL REVIEW';
const isDeclined = (q: QuoteSummary) => q.status === 'NOT APPROVED';
// Standard pricing, or a Deal Review that was approved: the quote can go to the customer.
const isReady = (q: QuoteSummary) => !isWaiting(q) && !isDeclined(q);

const SORTS: Record<Sort, (a: QuoteSummary, b: QuoteSummary) => number> = {
  newest: (a, b) => b.lockedAt.localeCompare(a.lockedAt),
  // quotes without an expiry (waiting or declined) go last
  expiring: (a, b) => (a.expiresAt || '9999').localeCompare(b.expiresAt || '9999') || b.lockedAt.localeCompare(a.lockedAt),
  price: (a, b) => (b.finalPrice ?? -1) - (a.finalPrice ?? -1),
};

// The rarely used actions, out of the way of the everyday ones.
function CardMenu({ label, onRemove, busy }: { label: string; onRemove: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="card-menu" ref={ref}>
      <button
        type="button"
        className="card-menu-btn"
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></svg>
      </button>
      {open ? (
        <div className="card-menu-panel" role="menu">
          <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => { setOpen(false); onRemove(); }}>
            Remove from dashboard
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DashboardClient({ userName }: { userName: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [search, setSearch] = useState('');

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/quotes', { cache: 'no-store' });
      if (res.status === 401) {
        location.href = '/login';
        return;
      }
      if (!res.ok) throw new Error('Could not load your quotes');
      const data = await res.json();
      setQuotes(data.quotes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your quotes');
      setQuotes([]);
    }
  }

  useEffect(() => { void load(); }, []);

  // Download PDF: the calculator builds the quote PDF (the same one it downloads) in a hidden
  // frame and reports back.
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== location.origin || e.data?.type !== 'grt-pdf') return;
      setDownloading(null);
      if (!e.data.ok) setError(e.data.error || 'The quote PDF could not be built.');
      const frame = frameRef.current;
      setTimeout(() => frame?.remove(), 5000);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function downloadPdf(id: string) {
    setError('');
    setDownloading(id);
    frameRef.current?.remove();
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Quote PDF';
    frame.src = `/api/calculator?download=${encodeURIComponent(id)}`;
    document.body.appendChild(frame);
    frameRef.current = frame;
  }

  const stats = useMemo(() => {
    const list = quotes || [];
    const last = list.reduce<string | null>((max, q) => (!max || q.lockedAt > max ? q.lockedAt : max), null);
    return {
      total: list.length,
      waiting: list.filter(isWaiting).length,
      ready: list.filter(isReady).length,
      declined: list.filter(isDeclined).length,
      last,
    };
  }, [quotes]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (quotes || [])
      .filter((q) => {
        if (filter === 'waiting' && !isWaiting(q)) return false;
        if (filter === 'ready' && !isReady(q)) return false;
        if (filter === 'declined' && !isDeclined(q)) return false;
        if (!term) return true;
        return [q.customerName, q.requestId, q.stage, q.hubspot?.dealName]
          .some((v) => v && v.toLowerCase().includes(term));
      })
      .sort(SORTS[sort]);
  }, [quotes, filter, search, sort]);

  // The stat boxes are the filters; Not approved only shows when there are any.
  const boxes: { tone: string; key: Filter; label: string; count: number }[] = [
    { tone: 'total', key: 'all', label: 'All requests', count: stats.total },
    { tone: 'review', key: 'waiting', label: 'Waiting for approval', count: stats.waiting },
    { tone: 'standard', key: 'ready', label: 'Ready to send', count: stats.ready },
    ...(stats.declined ? [{ tone: 'declined', key: 'declined' as const, label: 'Not approved', count: stats.declined }] : []),
  ];

  async function removeQuote(id: string) {
    if (!confirm('Remove this quote from your dashboard?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setQuotes((prev) => (prev || []).filter((q) => q.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub welcome">
            Welcome back, {userName}
            {quotes && stats.last ? ` · last locked ${fmtShort(stats.last)}` : ''}
          </p>
        </div>
        <a className="btn primary" href="/calculator">New pricing request</a>
      </div>

      <div className="stats dash-stats" style={{ '--cols': boxes.length } as CSSProperties}>
        {boxes.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`stat ${b.tone} stat-btn${filter === b.key ? ' active' : ''}`}
            aria-pressed={filter === b.key}
            onClick={() => setFilter(b.key)}
          >
            <span>{b.label}</span><b>{quotes ? b.count : '—'}</b>
          </button>
        ))}
      </div>

      <div className="err" role="alert">{error}</div>

      <h2 className="list-title">Locked requests</h2>
      {quotes && quotes.length > 0 ? (
        <div className="list-toolbar">
          <input
            type="search"
            className="search"
            placeholder="Search customer, request ID or deal"
            aria-label="Search locked requests"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest</option>
              <option value="expiring">Expiring soonest</option>
              <option value="price">Highest price</option>
            </select>
          </label>
        </div>
      ) : null}
      {!quotes ? (
        <div className="empty">Loading your quotes…</div>
      ) : quotes.length === 0 ? (
        <div className="empty">
          <p>No locked requests yet.</p>
          <p style={{ marginTop: 8 }}>Lock a pricing request in the calculator and it will show up here.</p>
          <div style={{ marginTop: 16 }}>
            <a className="btn primary" href="/calculator">Open calculator</a>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>No requests match.</p>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn small" onClick={() => { setSearch(''); setFilter('all'); }}>
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <div className="grid">
          {shown.map((q) => {
            const waiting = isWaiting(q);
            const approved = q.status === 'APPROVED';
            const declined = isDeclined(q);
            return (
              <article key={q.id} className="card quote-card">
                <div className="card-top">
                  <span className={`pill ${waiting ? 'review' : declined ? 'declined' : 'standard'}`}>
                    {waiting ? 'Waiting for approval' : approved ? 'Approved' : declined ? 'Not approved' : 'Standard'}
                  </span>
                  <CardMenu label={q.customerName} busy={busyId === q.id} onRemove={() => void removeQuote(q.id)} />
                </div>
                <h3>{q.customerName}</h3>
                <div className="quote-price">
                  {money(q.finalPrice, q.currency)} <span>Year 1</span>
                </div>
                {q.expiresAt ? <div className="card-expiry"><ExpiryTag expiresAt={q.expiresAt} /></div> : null}
                <div className="quote-meta">
                  <DecisionLine decision={q.decision} />
                  <div className="meta-line">
                    {[q.requestId + (q.version > 1 ? ` v${q.version}` : ''), q.stage, `locked ${fmtDate(q.lockedAt)}`].filter(Boolean).join(' · ')}
                  </div>
                  {q.hubspot?.dealId ? (
                    <div className="meta-line hs">
                      {q.hubspot.dealName ? <>Deal: {q.hubspot.dealName} · </> : null}
                      <HubSpotSyncLine hubspot={q.hubspot} status={q.status} />
                    </div>
                  ) : null}
                </div>
                <div className="quote-actions">
                  {isReady(q) ? (
                    <button
                      className="btn small primary"
                      type="button"
                      disabled={downloading === q.id}
                      onClick={() => downloadPdf(q.id)}
                    >
                      {downloading === q.id ? 'Preparing…' : 'Download PDF'}
                    </button>
                  ) : null}
                  <a className="btn small" href={`/calculator?revise=${encodeURIComponent(q.id)}`}>
                    Open / revise
                  </a>
                  {/* Starts a new request with the same setup, for a similar customer */}
                  <a
                    className="btn small"
                    href={`/calculator?copy=${encodeURIComponent(q.id)}`}
                    title="Start a new request with the same setup"
                  >
                    Duplicate
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
