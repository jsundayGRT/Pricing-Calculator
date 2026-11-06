'use client';

/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useState } from 'react';
import type { Decision, HubSpotSync } from '@/lib/quotes';
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
};

function fmtDay(day: string) {
  // decision dates are calendar days (YYYY-MM-DD); show them without a time-zone shift
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function DecisionLine({ decision }: { decision?: Decision | null }) {
  if (!decision) return null;
  const approved = decision.outcome === 'approved';
  return (
    <div className={`decision ${approved ? 'ok' : 'bad'}`}>
      <b>{approved ? 'Approved' : 'Not approved'}</b> by {decision.by}
      {decision.at ? ` · ${fmtDay(decision.at)}` : ''}
      {/* Only a decline's reason is shown; approvals just say who and when. */}
      {!approved && decision.note ? <div className="decision-note">Reason: {decision.note}</div> : null}
    </div>
  );
}

function money(amount?: number | null, currency?: string | null) {
  if (amount == null) return '—';
  const pre = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${pre}${Math.round(amount).toLocaleString('en-US')}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtShort(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Filter = 'all' | 'standard' | 'review';
const isReview = (q: QuoteSummary) => q.status === 'DEAL REVIEW';

export function DashboardClient({ userName }: { userName: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
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

  const stats = useMemo(() => {
    const list = quotes || [];
    const review = list.filter(isReview).length;
    const last = list.reduce<string | null>((max, q) => (!max || q.lockedAt > max ? q.lockedAt : max), null);
    return {
      total: list.length,
      review,
      standard: list.length - review,
      last,
    };
  }, [quotes]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (quotes || []).filter((q) => {
      if (filter === 'review' && !isReview(q)) return false;
      if (filter === 'standard' && isReview(q)) return false;
      if (!term) return true;
      return [q.customerName, q.requestId, q.stage, q.hubspot?.dealName]
        .some((v) => v && v.toLowerCase().includes(term));
    });
  }, [quotes, filter, search]);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: stats.total },
    { key: 'standard', label: 'Standard', count: stats.standard },
    { key: 'review', label: 'Deal Review', count: stats.review },
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
        </div>
        <a className="btn primary" href="/calculator">New pricing request</a>
      </div>

      <div className="hero compact">
        <div className="amount">Welcome back, {userName}</div>
        {quotes && stats.total ? (
          <small>
            {stats.total} locked request{stats.total === 1 ? '' : 's'}
            {stats.last ? ` · last on ${fmtShort(stats.last)}` : ''}
          </small>
        ) : null}
      </div>

      {/* The stat boxes double as filters for the list below */}
      <div className="stats">
        {([
          ['total', 'all', 'Your quotes', stats.total],
          ['standard', 'standard', 'Standard', stats.standard],
          ['review', 'review', 'Deal review', stats.review],
        ] as const).map(([tone, key, label, count]) => (
          <button
            key={key}
            type="button"
            className={`stat ${tone} stat-btn${filter === key ? ' active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            <span>{label}</span><b>{quotes ? count : '—'}</b>
          </button>
        ))}
      </div>

      <div className="err" role="alert">{error}</div>

      <div className="list-head">
        <h2>Locked requests</h2>
        {quotes && quotes.length > 0 ? (
          <div className="list-tools">
            <input
              type="search"
              className="search"
              placeholder="Search customer, request ID or deal"
              aria-label="Search locked requests"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="seg" role="group" aria-label="Filter by type">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  className={filter === f.key ? 'active' : ''}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label} <span className="count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
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
            const review = isReview(q);
            const approved = q.status === 'APPROVED';
            const declined = q.status === 'NOT APPROVED';
            return (
              <article key={q.id} className="card quote-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span className={`pill ${review ? 'review' : declined ? 'declined' : 'standard'}`}>
                    {review ? 'Deal Review' : approved ? 'Approved' : declined ? 'Not approved' : 'Standard'}
                  </span>
                  {q.version > 1 ? <span className="quote-meta">v{q.version}</span> : null}
                </div>
                <h3>{q.customerName}</h3>
                <div className="quote-price">
                  {money(q.finalPrice, q.currency)} <span>Year 1</span>
                </div>
                <div className="quote-meta">
                  <DecisionLine decision={q.decision} />
                  <div className="meta-line">
                    {[fmtDate(q.lockedAt), q.requestId, q.stage].filter(Boolean).join(' · ')}
                  </div>
                  {q.hubspot?.dealId ? (
                    <div className="meta-line hs">
                      {q.hubspot.dealName ? <>Deal: {q.hubspot.dealName} · </> : null}
                      <HubSpotSyncLine hubspot={q.hubspot} status={q.status} />
                    </div>
                  ) : null}
                </div>
                <div className="quote-actions">
                  <a className="btn small" href={`/calculator?revise=${encodeURIComponent(q.id)}`}>
                    Open / revise
                  </a>
                  <button
                    className="btn small danger"
                    type="button"
                    disabled={busyId === q.id}
                    onClick={() => void removeQuote(q.id)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
