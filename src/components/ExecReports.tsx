'use client';

import { useMemo, useState } from 'react';
import type { ExecQuoteSummary } from '@/lib/quote-view';

// Discount, margin and Deal Review numbers for the requests the filters above select. Prices in
// other currencies are converted to US dollars at each request's own exchange rate.

const REVIEWED = new Set(['DEAL REVIEW', 'APPROVED', 'NOT APPROVED']);

type Row = {
  key: string;
  label: string;
  count: number;
  reviewed: number;
  approved: number;
  declined: number;
  avgDiscount: number | null;
  avgMargin: number | null;
  valueUsd: number;
};

function avg(values: (number | null)[]) {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarize(key: string, label: string, list: ExecQuoteSummary[]): Row {
  return {
    key,
    label,
    count: list.length,
    reviewed: list.filter((q) => REVIEWED.has(q.status)).length,
    approved: list.filter((q) => q.status === 'APPROVED').length,
    declined: list.filter((q) => q.status === 'NOT APPROVED').length,
    avgDiscount: avg(list.map((q) => q.discountAppliedPct)),
    avgMargin: avg(list.map((q) => q.finalMarginPct)),
    valueUsd: list.reduce((sum, q) => sum + (q.finalPriceUsd ?? 0), 0),
  };
}

function groupBy(list: ExecQuoteSummary[], keyOf: (q: ExecQuoteSummary) => string) {
  const groups = new Map<string, ExecQuoteSummary[]>();
  for (const q of list) {
    const k = keyOf(q);
    groups.set(k, [...(groups.get(k) || []), q]);
  }
  return groups;
}

const pct = (v: number | null, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);
const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

function duration(ms: number | null) {
  if (ms == null) return '—';
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function monthKey(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Unknown';
}

export function ExecReports({ quotes }: { quotes: ExecQuoteSummary[] }) {
  const [by, setBy] = useState<'rep' | 'month'>('rep');

  const totals = useMemo(() => {
    const decisionTimes = quotes
      .filter((q) => q.decidedAt)
      .map((q) => Date.parse(q.decidedAt!) - Date.parse(q.lockedAt))
      .filter((ms) => Number.isFinite(ms) && ms >= 0);
    return { all: summarize('all', 'All', quotes), decisionTime: median(decisionTimes), decided: decisionTimes.length };
  }, [quotes]);

  const rows = useMemo(() => {
    if (by === 'rep') {
      return [...groupBy(quotes, (q) => q.rep || 'Unknown')]
        .map(([k, list]) => summarize(k, k, list))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
    return [...groupBy(quotes, (q) => monthKey(q.lockedAt))]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([k, list]) => summarize(k, monthLabel(k), list));
  }, [quotes, by]);

  if (!quotes.length) return <div className="empty">No requests match the filters.</div>;
  const t = totals.all;

  return (
    <section className="reports" aria-label="Reports">
      <div className="report-tiles">
        <div className="report-tile"><span>Requests</span><b>{t.count}</b></div>
        <div className="report-tile"><span>Went to Deal Review</span><b>{share(t.reviewed, t.count)}</b><small>{t.reviewed} of {t.count}</small></div>
        <div className="report-tile"><span>Average discount</span><b>{pct(t.avgDiscount)}</b><small>additional, as applied</small></div>
        <div className="report-tile"><span>Average margin</span><b>{pct(t.avgMargin)}</b></div>
        <div className="report-tile"><span>Time to a decision</span><b>{duration(totals.decisionTime)}</b><small>{totals.decided ? `median of ${totals.decided} Deal Review${totals.decided === 1 ? '' : 's'}` : 'no decisions yet'}</small></div>
        <div className="report-tile"><span>Year 1 value</span><b>{usd(t.valueUsd)}</b><small>in US dollars</small></div>
      </div>

      <div className="list-head">
        <h2>{by === 'rep' ? 'By rep' : 'By month'}</h2>
        <div className="seg" role="group" aria-label="Group the report">
          <button type="button" aria-pressed={by === 'rep'} className={by === 'rep' ? 'active' : ''} onClick={() => setBy('rep')}>By rep</button>
          <button type="button" aria-pressed={by === 'month'} className={by === 'month' ? 'active' : ''} onClick={() => setBy('month')}>By month</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="exec report-table">
          <thead>
            <tr>
              <th>{by === 'rep' ? 'Rep' : 'Month'}</th>
              <th className="num">Requests</th>
              <th className="num">Deal Review</th>
              <th className="num">Approved</th>
              <th className="num">Not approved</th>
              <th className="num">Avg discount</th>
              <th className="num">Avg margin</th>
              <th className="num">Year 1 value (USD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><b>{r.label}</b></td>
                <td className="num">{r.count}</td>
                <td className="num">{r.reviewed} <span className="share">· {share(r.reviewed, r.count)}</span></td>
                <td className="num">{r.approved}</td>
                <td className="num">{r.declined}</td>
                <td className="num">{pct(r.avgDiscount)}</td>
                <td className="num">{pct(r.avgMargin)}</td>
                <td className="num">{usd(r.valueUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
