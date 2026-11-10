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

// Someone's name, or until we know it (they haven't signed in yet) one made from their email:
// dena.lumbang@guardrail.tech → Dena Lumbang.
function displayName(p: { name?: string; email: string }) {
  if (p.name) return p.name;
  return p.email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || p.email;
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
  const [role, setRole] = useState<UserRole | ''>(''); // empty until a person is picked
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
      setSaved(`${who ? displayName(who) : email} is now ${role === 'admin' ? 'an admin' : 'a rep'}.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the role.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  // takes the picked person off the list, after asking
  async function remove() {
    if (!picked) return;
    const name = displayName(picked);
    const access = picked.role === 'admin' ? ' and lose admin access' : '';
    if (!confirm(`Remove ${name}?\n\nThey'll leave this list${access}. Their locked requests stay. If they use the app again, they'll come back as a rep.`)) return;
    setError(''); setSaved(''); setBusy(picked.email);
    try {
      const res = await fetch('/api/admin/roles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: picked.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove.');
      setPeople(data.people);
      setPick(''); setRole('');
      setSaved(`${name} was removed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(null);
    }
  }

  const picked = (people || []).find((p) => p.email === pick) || null;
  const isNew = pick === NEW;
  const self = !!picked && picked.email === me;

  // picking someone shows their current role, ready to change; someone new starts as a rep
  function choose(value: string, focusRole = false) {
    setPick(value); setSaved(''); setError('');
    const who = (people || []).find((p) => p.email === value);
    setRole(who?.role || (value === NEW ? 'rep' : ''));
    if (focusRole && value !== me) setTimeout(() => document.getElementById('role-role')?.focus(), 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!role) return;
    if (isNew) {
      if (await save(newEmail, role, newName)) { setNewEmail(''); setNewName(''); setPick(newEmail.trim().toLowerCase()); }
    } else if (picked) {
      await save(picked.email, role);
    }
  }
  const unchanged = !!picked && picked.role === role;

  return (
    <main className="page roles-page">
      <div className="page-head">
        <div>
          <h1>Manage roles</h1>
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
                {displayName(p)} ({p.email}){p.email === me ? ' · you' : ''}
              </option>
            ))}
            <option value={NEW}>Someone new…</option>
          </select>
        </div>
        <div>
          <label htmlFor="role-role">Role</label>
          <select id="role-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!pick || self}>
            <option value="" disabled hidden>—</option>
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={!pick || !role || self || unchanged || busy !== null}>Save</button>
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
          <div className="roles-hint roles-picked">
            <p className="sub">
              {displayName(picked)} is {picked.role === 'admin' ? 'an admin' : 'a rep'}
              {picked.roleChangedBy ? `, set by ${picked.roleChangedBy} on ${fmtDate(picked.roleChangedAt)}` : picked.defaultAdmin ? ' by default' : ''}.
            </p>
            <button className="btn small danger" type="button" onClick={() => void remove()} disabled={busy !== null}>
              Remove {displayName(picked)}
            </button>
          </div>
        ) : null}
      </form>


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
                // clicking a row picks that person in the box above
                <tr key={p.email} className={p.email === pick ? 'picked' : undefined} onClick={() => choose(p.email, true)}>
                  <td className="roles-who">
                    <button type="button" className="roles-pick" aria-label={`Change role for ${displayName(p)}`} onClick={(e) => { e.stopPropagation(); choose(p.email, true); }}>
                      {displayName(p)}
                    </button>
                    {p.email === me ? <span className="sub"> (you)</span> : null}
                    <div className="sub">{p.email}</div>
                    {p.roleChangedBy ? <div className="sub roles-note">Set by {p.roleChangedBy} on {fmtDate(p.roleChangedAt)}</div> : null}
                  </td>
                  <td className="sub roles-seen"><span className="roles-seen-label">Last active </span>{p.lastSeenAt || p.lastSignInAt ? fmtWhen(p.lastSeenAt || p.lastSignInAt) : 'Not yet'}</td>
                  <td className="roles-role"><span className={`role-tag ${p.role}`}>{p.role === 'admin' ? 'Admin' : 'Rep'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
