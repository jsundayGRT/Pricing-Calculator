'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ExecQuoteSummary } from '@/lib/quote-view';
import type { HubSpotSync } from '@/lib/quotes';
import { hubspotLabel, quoteLink } from './HubSpotSyncLine';

type DetailPayload = {
  summary: ExecQuoteSummary;
  quote: {
    snapshot: Record<string, unknown>;
    ownerEmail: string;
    ownerName: string;
    hubspot?: HubSpotSync | null;
  };
};

function fmtWhen(iso?: string | null) {
  return iso ? fmtDate(iso) : '—';
}

const MODULE_LABELS: Record<string, string> = {
  codeAi: 'Code + AI',
  shadow: 'Shadow',
  drift: 'Drift',
  content: 'Content',
  creative: 'Creative',
  aiq: 'AiQ',
};

function money(amount?: number | null, currency?: string | null) {
  if (amount == null) return '—';
  const pre = currency && currency !== 'USD' ? `${currency} ` : '$';
  return `${pre}${Math.round(amount).toLocaleString('en-US')}`;
}

function pct(v?: number | null, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function pts(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = (v * 100).toFixed(1);
  return `${v >= 0 ? '+' : ''}${n} pts`;
}

function decisionBy(snapshot: Record<string, unknown>, key: 'approval' | 'decision') {
  const record = snapshot[key] as { by?: string; note?: string } | undefined;
  const by = record?.by ? ` by ${record.by}` : '';
  return key === 'decision' && record?.note ? `${by}: ${record.note}` : by;
}

function logLabel(action?: string) {
  if (action === 'approved') return 'Approved';
  if (action === 'not-approved') return 'Not approved';
  return 'Note';
}

function RequestLog({ snapshot }: { snapshot: Record<string, unknown> }) {
  const log = Array.isArray(snapshot.log)
    ? snapshot.log as Array<{ at?: string; by?: string; action?: string; note?: string }>
    : [];
  if (!log.length) return <p className="sub" style={{ marginTop: 12 }}>No updates yet.</p>;
  return (
    <ol className="log-list">
      {log.map((entry, index) => (
        <li key={`${entry.at || 'log'}-${index}`}>
          <strong>{logLabel(entry.action)}</strong>
          <span className="quote-meta">
            {entry.by ? ` · ${entry.by}` : ''}
            {entry.at ? ` · ${fmtDate(entry.at)}` : ''}
          </span>
          {entry.note ? <p>{entry.note}</p> : null}
        </li>
      ))}
    </ol>
  );
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

function yn(v: unknown) {
  return v ? 'Yes' : 'No';
}

export function ExecutiveSummaryClient() {
  const [quotes, setQuotes] = useState<ExecQuoteSummary[] | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('ALL');
  const [rep, setRep] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  // Decision panel: Decline asks for the reason. A decision is final.
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  function resetDecisionForm() {
    setDeclining(false);
    setReason('');
  }

  async function decide(id: string, action: 'approve' | 'decline') {
    const note = action === 'decline' ? reason.trim() : '';
    if (action === 'decline' && !note) {
      setError('Give the reason it is not approved.');
      return;
    }
    setApproving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) throw new Error(action === 'approve' ? 'Could not approve this request' : 'Could not decline this request');
      const data = await res.json();
      setDetail(data);
      setQuotes((prev) => (prev || []).map((q) => (q.id === id ? data.summary : q)));
      resetDecisionForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this decision');
    } finally {
      setApproving(false);
    }
  }

  async function retrySync(id: string) {
    setApproving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/quotes/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry-sync' }),
      });
      if (!res.ok) throw new Error('Could not retry the HubSpot sync');
      setDetail(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry the HubSpot sync');
    } finally {
      setApproving(false);
    }
  }

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/admin/quotes', { cache: 'no-store', redirect: 'manual' });
      if (res.status === 401 || res.status === 307 || res.status === 302 || res.type === 'opaqueredirect') {
        setError('Your session expired. Use Sign out, then sign in again with your Guardrail account.');
        setQuotes([]);
        return;
      }
      if (res.status === 403) { setError('Admin access required for this account.'); setQuotes([]); return; }
      if (!res.ok) throw new Error('Could not load the Executive Dashboard');
      const data = await res.json();
      setQuotes(data.quotes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Executive Dashboard');
      setQuotes([]);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    resetDecisionForm();
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/admin/quotes/${encodeURIComponent(selectedId)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Could not load request detail');
        const data = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load request detail');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const reps = useMemo(() => {
    const set = new Set((quotes || []).map((q) => q.rep).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [quotes]);

  const filtered = useMemo(() => {
    const list = quotes || [];
    return list.filter((q) => {
      if (status !== 'ALL' && q.status !== status) return false;
      if (rep !== 'ALL' && q.rep !== rep) return false;
      if (from) {
        const t = new Date(q.lockedAt).getTime();
        if (t < new Date(`${from}T00:00:00`).getTime()) return false;
      }
      if (to) {
        const t = new Date(q.lockedAt).getTime();
        if (t > new Date(`${to}T23:59:59`).getTime()) return false;
      }
      return true;
    });
  }, [quotes, status, rep, from, to]);

  const stats = useMemo(() => {
    const review = filtered.filter((q) => q.status === 'DEAL REVIEW').length;
    return { total: filtered.length, review, standard: filtered.length - review };
  }, [filtered]);

  const snap = detail?.quote.snapshot || null;
  const inputs = (snap?.inputs || {}) as Record<string, unknown>;
  const customer = (snap?.customer || {}) as Record<string, unknown>;
  const internal = (snap?.internal || {}) as Record<string, unknown>;
  const costs = (internal.costs || {}) as Record<string, unknown>;
  const profit = (internal.profit || {}) as Record<string, unknown>;
  const modulesObj = (inputs.modules || {}) as Record<string, unknown>;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Executive Dashboard</h1>
          <p className="sub">All locked pricing requests · Deal Reviews first · internal economics included</p>
        </div>
        <button className="btn small" type="button" onClick={() => void load()}>Refresh</button>
      </div>

      <div className="stats">
        <div className="stat total"><span>Shown</span><b>{quotes ? stats.total : '—'}</b></div>
        <div className="stat review"><span>Deal review</span><b>{quotes ? stats.review : '—'}</b></div>
        <div className="stat standard"><span>Standard</span><b>{quotes ? stats.standard : '—'}</b></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters">
          <div>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All</option>
              <option value="DEAL REVIEW">Deal Review</option>
              <option value="APPROVED">Approved</option>
              <option value="NOT APPROVED">Not approved</option>
              <option value="STANDARD">Standard</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-rep">Rep</label>
            <select id="f-rep" value={rep} onChange={(e) => setRep(e.target.value)}>
              <option value="ALL">All reps</option>
              {reps.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="err" role="alert">{error}</div>

      {!quotes ? (
        <div className="empty">Loading locked requests…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No locked requests match these filters.</div>
      ) : (
        <div className="table-wrap">
          <table className="exec">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rep</th>
                <th>Customer</th>
                <th>Tier / seats</th>
                <th>Location</th>
                <th>Modules</th>
                <th>Term</th>
                <th>Discount</th>
                <th>Final price</th>
                <th>Amount due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => {
                const review = q.status === 'DEAL REVIEW';
                const approved = q.status === 'APPROVED';
                const declined = q.status === 'NOT APPROVED';
                return (
                  <tr
                    key={q.id}
                    className={review ? 'review' : declined ? 'declined' : undefined}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <td>{fmtDate(q.lockedAt)}</td>
                    <td>{q.rep}</td>
                    <td>
                      <b>{q.customerName}</b>
                      <div className="quote-meta">{q.requestId}{q.version > 1 ? ` · v${q.version}` : ''}</div>
                    </td>
                    <td>
                      {q.band || '—'}
                      {q.seats != null ? ` · ${q.seats.toLocaleString()} seats` : ''}
                    </td>
                    <td>{q.location || '—'}</td>
                    <td>{q.modules.map((m) => MODULE_LABELS[m] || m).join(', ') || 'None'}</td>
                    <td>{q.term || '—'}</td>
                    <td className="num">
                      req {pct(q.discountRequestedPct, 1)}
                      <div className="quote-meta">applied {pct(q.discountAppliedPct, 2)}</div>
                    </td>
                    <td className="num">{money(q.finalPrice, q.currency)}</td>
                    <td className="num">{money(q.year1Due, q.currency)}</td>
                    <td>
                      <span className={`pill ${review ? 'review' : declined ? 'declined' : 'standard'}`}>
                        {review ? 'Deal Review' : approved ? 'Approved' : declined ? 'Not approved' : 'Standard'}
                      </span>
                      {review && q.reviewReason ? <div className="reason">{q.reviewReason}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedId ? (
        <>
          <div className="drawer-bg" onClick={() => setSelectedId(null)} />
          <aside className="drawer" role="dialog" aria-label="Request detail">
            <div className="drawer-head">
              <div>
                <h1 style={{ fontSize: 22 }}>{detail?.summary.customerName || 'Request detail'}</h1>
                <p className="sub">
                  {detail
                    ? `${detail.summary.requestId}${detail.summary.version > 1 ? ` · v${detail.summary.version}` : ''} · ${fmtDate(detail.summary.lockedAt)} · ${detail.summary.rep}`
                    : 'Loading…'}
                </p>
              </div>
              <button className="btn small" type="button" onClick={() => setSelectedId(null)}>Close</button>
            </div>

            {detailLoading || !detail ? (
              <div className="empty">Loading detail…</div>
            ) : (
              <>
                {detail.summary.status === 'DEAL REVIEW' ? (
                  <div className="flag warn">
                    Deal Review
                    {detail.summary.reviewReason ? `: ${detail.summary.reviewReason}` : ''}
                    {detail.summary.dealNote ? ` — ${detail.summary.dealNote}` : ''}
                  </div>
                ) : detail.summary.status === 'APPROVED' ? (
                  <div className="flag ok">Approved{decisionBy(detail.quote.snapshot, 'approval')}</div>
                ) : detail.summary.status === 'NOT APPROVED' ? (
                  <div className="flag bad">Not approved{decisionBy(detail.quote.snapshot, 'decision')}</div>
                ) : null}

                <div className="card" style={{ marginBottom: 16 }}>
                  <h2>Decision</h2>
                  {(() => {
                    const status = detail.summary.status;
                    const decided = status === 'APPROVED' || status === 'NOT APPROVED';
                    if (decided) return null;
                    if (declining) {
                      return (
                        <form className="log-form" onSubmit={(event) => { event.preventDefault(); void decide(detail.summary.id, 'decline'); }}>
                          <label htmlFor="decline-reason">Why is it not approved?</label>
                          <textarea
                            id="decline-reason"
                            value={reason}
                            maxLength={500}
                            autoFocus
                            placeholder="The rep sees this reason on their dashboard"
                            onChange={(event) => setReason(event.target.value)}
                          />
                          <div className="review-actions" style={{ marginTop: 0 }}>
                            <button className="btn decline" type="submit" disabled={approving || !reason.trim()}>
                              {approving ? 'Saving…' : 'Decline'}
                            </button>
                            <button className="btn small" type="button" disabled={approving} onClick={() => setDeclining(false)}>Cancel</button>
                          </div>
                        </form>
                      );
                    }
                    return (
                      <div className="review-actions" style={{ marginTop: 0 }}>
                        <button className="btn approve" type="button" disabled={approving} onClick={() => void decide(detail.summary.id, 'approve')}>
                          {approving ? 'Saving…' : 'Approve'}
                        </button>
                        <button className="btn decline" type="button" disabled={approving} onClick={() => setDeclining(true)}>Decline</button>
                      </div>
                    );
                  })()}
                  <h2 style={{ marginTop: detail.summary.status === 'APPROVED' || detail.summary.status === 'NOT APPROVED' ? 0 : 16 }}>History</h2>
                  <RequestLog snapshot={detail.quote.snapshot} />
                </div>

                {detail.quote.hubspot?.dealId ? (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <h2>HubSpot</h2>
                    {detail.quote.hubspot.status === 'failed' ? (
                      <div className="flag bad">HubSpot sync failed{detail.quote.hubspot.error ? `: ${detail.quote.hubspot.error}` : ''}</div>
                    ) : null}
                    <table className="kv"><tbody>
                      <tr><td>Deal</td><td>{detail.quote.hubspot.dealName || detail.quote.hubspot.dealId}</td></tr>
                      <tr><td>Status</td><td>{hubspotLabel(detail.quote.hubspot, detail.summary.status)}</td></tr>
                      <tr><td>Quote</td><td>{quoteLink(detail.quote.hubspot)
                        ? <a href={quoteLink(detail.quote.hubspot)!} target="_blank" rel="noopener noreferrer">Open in HubSpot</a>
                        : '—'}</td></tr>
                      <tr><td>Last synced</td><td>{fmtWhen(detail.quote.hubspot.syncedAt)}</td></tr>
                      <tr><td>Attempts</td><td>{detail.quote.hubspot.attempts ?? 0}</td></tr>
                    </tbody></table>
                    {detail.quote.hubspot.status === 'failed' || detail.quote.hubspot.status === 'pending' ? (
                      <div className="review-actions">
                        <button className="btn primary" type="button" disabled={approving} onClick={() => void retrySync(detail.summary.id)}>
                          {approving ? 'Syncing…' : 'Retry sync'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="card" style={{ marginBottom: 16 }}>
                  <h2>Customer view</h2>
                  <div className="two">
                    <table className="kv"><tbody>
                      <tr><td>Final price (Year 1)</td><td className="num">{money(detail.summary.finalPrice, detail.summary.currency)}</td></tr>
                      <tr><td>Amount due at signing</td><td className="num">{money(detail.summary.year1Due, detail.summary.currency)}</td></tr>
                      <tr><td>Annual recurring</td><td className="num">{money(num(customer.annualRecurringPrice), detail.summary.currency)}</td></tr>
                      <tr><td>Implementation</td><td className="num">{money(num(customer.implementation), detail.summary.currency)}</td></tr>
                    </tbody></table>
                    <table className="kv"><tbody>
                      <tr><td>Band</td><td>{String(inputs.band || '—')}</td></tr>
                      <tr><td>Seats</td><td>{inputs.seats == null ? '—' : Number(inputs.seats).toLocaleString()}</td></tr>
                      <tr><td>Location</td><td>{String(inputs.location || '—')}</td></tr>
                      <tr><td>Term</td><td>{String(inputs.term || '—')}</td></tr>
                      <tr><td>Command Center</td><td>{yn(inputs.commandCenter)}</td></tr>
                      <tr><td>On-prem</td><td>{yn(inputs.onPrem)}</td></tr>
                      <tr><td>Early Pay</td><td>{yn(inputs.earlyPay)}</td></tr>
                      <tr><td>Modules</td><td>{
                        Object.entries(modulesObj).filter(([, on]) => on).map(([k]) => MODULE_LABELS[k] || k).join(', ') || 'None'
                      }</td></tr>
                    </tbody></table>
                  </div>
                </div>

                <div className="card internal">
                  <h2>Internal only</h2>
                  {!Object.keys(internal).length ? (
                    <p className="sub">
                      This quote was locked before internal economics were saved. Lock a new version from the calculator to capture cost and margin detail.
                    </p>
                  ) : (
                    <div className="two">
                      <div>
                        <h3>Margin and discount</h3>
                        <table className="kv"><tbody>
                          <tr><td>Final margin</td><td className={clsNeg(num(internal.finalMarginPct))}>{pct(num(internal.finalMarginPct))}</td></tr>
                          <tr><td>Regional margin target</td><td>{pct(num(internal.regionalTargetPct))}</td></tr>
                          <tr><td>Gap to target</td><td className={clsGap(num(internal.gapToTargetPts))}>{pts(num(internal.gapToTargetPts))}</td></tr>
                          <tr><td>Minimum margin (floor)</td><td>{pct(num(internal.minimumMargin))}</td></tr>
                          <tr><td>Requested variable discount</td><td>{pct(num(internal.requestedVariableDiscountPct), 2)}</td></tr>
                          <tr><td>Applied variable discount</td><td>{pct(num(internal.appliedVariableDiscountPct), 2)}</td></tr>
                          <tr><td>Maximum allowed (floor)</td><td>{pct(num(internal.maxVariableDiscountPct), 2)}</td></tr>
                        </tbody></table>
                      </div>
                      <div>
                        <h3>Cost to serve</h3>
                        <table className="kv"><tbody>
                          <tr><td>Inference, cloud, data, licenses</td><td className="num">{money(num(costs.inferenceCloudDataLicenses))}</td></tr>
                          <tr><td>Command Center runtime</td><td className="num">{money(num(costs.commandCenterRuntime))}</td></tr>
                          <tr><td>Customer success</td><td className="num">{money(num(costs.customerSuccess))}</td></tr>
                          <tr><td>Technical support</td><td className="num">{money(num(costs.technicalSupport))}</td></tr>
                          <tr><td>Hosting / security / compliance</td><td className="num">{money(num(costs.hostingSecurityCompliance))}</td></tr>
                          <tr><td>On-prem infrastructure</td><td className="num">{money(num(costs.onPremInfrastructure))}</td></tr>
                          <tr className="total"><td>Annual cost to serve</td><td className="num">{money(num(costs.annualCostToServe))}</td></tr>
                          <tr><td>Implementation delivery</td><td className="num">{money(num(costs.implementationDelivery))}</td></tr>
                          <tr className="total"><td>Total cost to serve</td><td className="num">{money(num(costs.totalCostToServe))}</td></tr>
                        </tbody></table>
                      </div>
                      <div>
                        <h3>Profit</h3>
                        <table className="kv"><tbody>
                          <tr><td>Gross profit, recurring</td><td className="num">{money(num(profit.grossProfitRecurring))} · {pct(num(profit.recurringMarginPct))}</td></tr>
                          <tr><td>Gross profit, Year 1</td><td className="num">{money(num(profit.grossProfitYear1))} · {pct(num(profit.year1MarginPct))}</td></tr>
                          <tr><td>Operating profit, Year 1</td><td className="num">{money(num(profit.operatingProfitYear1))} · {pct(num(profit.operatingMarginYear1Pct))}</td></tr>
                          <tr><td>Payback on CAC</td><td>{num(profit.paybackMonths) == null ? '—' : `${Number(profit.paybackMonths).toFixed(1)} months`}</td></tr>
                          <tr><td>LTV to CAC</td><td>{num(profit.ltvToCac) == null ? '—' : `${Number(profit.ltvToCac).toFixed(2)}×`}</td></tr>
                        </tbody></table>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </>
      ) : null}
    </main>
  );
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clsNeg(v: number | null) {
  return v != null && v < 0 ? 'neg' : undefined;
}

function clsGap(v: number | null) {
  if (v == null) return undefined;
  return v < 0 ? 'neg' : 'pos';
}
