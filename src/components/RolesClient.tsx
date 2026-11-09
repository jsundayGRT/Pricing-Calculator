'use client';

import { useEffect, useState } from 'react';
import type { PersonView, UserRole } from '@/lib/admin';

function fmtWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// Admins choose who is an admin and who is a rep. Admins see the Executive Dashboard, approve
// Deal Reviews, search every HubSpot deal and manage roles; reps price and lock their own requests.
const NEW = '__new__';

export function RolesClient({ myEmail, temporaryStorage = false }: { myEmail: string; temporaryStorage?: boolean }) {
  const [people, setPeople] = useState<PersonView[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState(''); // an email, NEW for someone not listed yet, or '' for none
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [role, setRole] = useState<UserRole>('rep');
  const me = myEmail.trim().toLowerCase();

  async function load() {
    setError('');
    try {
      const res = await fetch('/api/admin/roles', { cache: 'no-store' });
      if (res.status === 401) { location.href = '/login'; return; }
      if (!res.ok) throw new Error('Could not load people');
      setPeople((await res.json()).people || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load people');
      setPeople([]);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(email: string, role: UserRole, name?: string) {
    setError(''); setSaved(''); setBusy(email);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the role.');
      setPeople(data.people);
      const who = data.people.find((p: PersonView) => p.email === email.trim().toLowerCase());
      setSaved(`${who?.name || email} is now ${role === 'admin' ? 'an admin' : 'a rep'}.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the role.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const picked = (people || []).find((p) => p.email === pick) || null;
  const isNew = pick === NEW;
  const self = !!picked && picked.email === me;
  const admins = (people || []).filter((p) => p.role === 'admin').length;

  // picking someone shows their current role, ready to change
  function choose(value: string) {
    setPick(value); setSaved(''); setError('');
    setRole((people || []).find((p) => p.email === value)?.role || 'rep');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isNew) {
      if (await save(newEmail, role, newName)) { setNewEmail(''); setNewName(''); setPick(newEmail.trim().toLowerCase()); }
    } else if (picked) {
      await save(picked.email, role);
    }
  }
  const unchanged = !!picked && picked.role === role;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Manage roles</h1>
          <p className="sub">Admins see the Executive Dashboard, approve Deal Reviews and manage roles. Reps price and lock their own requests.</p>
        </div>
      </div>

      {temporaryStorage ? (
        <div className="err roles-warn">
          Roles and last-active dates aren&apos;t being saved permanently: this site has no Upstash Redis connected, so
          changes can be lost when the app restarts. In Vercel, open the project → Storage → connect Upstash for Redis,
          then redeploy.
        </div>
      ) : null}
      <div className="err" role="alert">{error}</div>
      <p className="roles-saved" role="status">{saved}</p>

      <form className="card roles-add" onSubmit={submit}>
        <div>
          <label htmlFor="role-person">Person</label>
          <select id="role-person" value={pick} onChange={(e) => choose(e.target.value)} disabled={!people}>
            <option value="" disabled>{people ? 'Choose a person' : 'Loading people…'}</option>
            {(people || []).map((p) => (
              <option key={p.email} value={p.email}>
                {p.name ? `${p.name} (${p.email})` : p.email}{p.email === me ? ' · you' : ''}
              </option>
            ))}
            <option value={NEW}>Someone new…</option>
          </select>
        </div>
        <div>
          <label htmlFor="role-role">Role</label>
          <select id="role-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!pick || self}>
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={!pick || self || unchanged || busy !== null}>Save</button>
        {isNew ? (
          <div className="roles-new">
            <div>
              <label htmlFor="new-email">Email</label>
              <input id="new-email" type="email" required placeholder="name@guardrail.tech" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="new-name">Name <span className="sub">Optional</span></label>
              <input id="new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
          </div>
        ) : null}
        {self ? <p className="sub roles-hint">You can&apos;t change your own role. Ask another admin.</p> : null}
        {picked && !self ? (
          <p className="sub roles-hint">
            {picked.name || picked.email} is {picked.role === 'admin' ? 'an admin' : 'a rep'}
            {picked.roleChangedBy ? `, set by ${picked.roleChangedBy} on ${fmtDate(picked.roleChangedAt)}` : picked.defaultAdmin ? ' by default' : ''}.
          </p>
        ) : null}
      </form>

      <p className="sub roles-count">{people ? `${people.length} people · ${admins} admin${admins === 1 ? '' : 's'}` : ''}</p>

      {!people ? (
        <div className="empty">Loading people…</div>
      ) : (
        <div className="table-wrap">
          <table className="roles">
            <thead>
              <tr><th>Person</th><th>Last active</th><th>Role</th></tr>
            </thead>
            <tbody>
              {(people || []).map((p) => (
                <tr key={p.email}>
                  <td>
                    <b>{p.name || p.email}</b>{p.email === me ? <span className="sub"> (you)</span> : null}
                    {p.name ? <div className="sub">{p.email}</div> : null}
                    {p.roleChangedBy ? <div className="sub roles-note">Set by {p.roleChangedBy} on {fmtDate(p.roleChangedAt)}</div> : null}
                  </td>
                  <td className="sub">{p.lastSeenAt || p.lastSignInAt ? fmtWhen(p.lastSeenAt || p.lastSignInAt) : 'Not yet'}</td>
                  <td><span className={`role-tag ${p.role}`}>{p.role === 'admin' ? 'Admin' : 'Rep'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
