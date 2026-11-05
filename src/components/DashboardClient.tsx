'use client';

/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useMemo, useState } from 'react';
import type { HubSpotSync } from '@/lib/quotes';
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
};

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

export function DashboardClient({ userName }: { userName: string }) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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
    const review = list.filter((q) => q.status === 'DEAL REVIEW').length;
    return {
      total: list.length,
      review,
      standard: list.length - review,
    };
  }, [quotes]);

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

      <div className="hero">
        <div className="amount">Welcome back, {userName}</div>
      </div>

      <div className="stats">
        <div className="stat"><span>Your quotes</span><b>{quotes ? stats.total : '—'}</b></div>
        <div className="stat"><span>Standard</span><b>{quotes ? stats.standard : '—'}</b></div>
        <div className="stat"><span>Deal review</span><b>{quotes ? stats.review : '—'}</b></div>
      </div>

      <div className="err" role="alert">{error}</div>

      <h2 style={{ marginBottom: 12 }}>Locked requests</h2>
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
      ) : (
        <div className="grid">
          {quotes.map((q) => {
            const review = q.status === 'DEAL REVIEW';
            const approved = q.status === 'APPROVED';
            const declined = q.status === 'NOT APPROVED';
            return (
              <article key={q.id} className="card quote-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span className={`pill ${review ? 'review' : declined ? 'declined' : 'standard'}`}>
                    {review ? 'Deal Review' : approved ? 'Approved' : declined ? 'Not approved' : 'Standard'}
                  </span>
                  <span className="quote-meta">v{q.version}</span>
                </div>
                <h3>{q.customerName}</h3>
                <div className="quote-meta">
                  <div>{q.requestId}</div>
                  <div>{fmtDate(q.lockedAt)}</div>
                  <div><b style={{ color: 'var(--text)' }}>{money(q.finalPrice, q.currency)}</b> · Year 1</div>
                  {q.stage ? <div>Stage: {q.stage}</div> : null}
                  {q.hubspot?.dealName ? <div>Deal: {q.hubspot.dealName}</div> : null}
                  <HubSpotSyncLine hubspot={q.hubspot} />
                </div>
                <div className="quote-actions">
                  <a className="btn small" href={`/calculator?revise=${encodeURIComponent(q.id)}`}>
                    Open / revise
                  </a>
                  <button
                    className="btn small"
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
