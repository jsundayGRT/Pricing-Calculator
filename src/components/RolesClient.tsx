'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PersonView, UserRole } from '@/lib/admin';

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
export function RolesClient({ myEmail }: { myEmail: string }) {
  const [people, setPeople] = useState<PersonView[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addRole, setAddRole] = useState<UserRole>('rep');
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

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (await save(addEmail, addRole, addName)) { setAddEmail(''); setAddName(''); setAddRole('rep'); }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (people || []).filter((p) => !q || p.email.includes(q) || p.name.toLowerCase().includes(q));
  }, [people, search]);
  const admins = (people || []).filter((p) => p.role === 'admin').length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Manage roles</h1>
          <p className="sub">Admins see the Executive Dashboard, approve Deal Reviews and manage roles. Reps price and lock their own requests.</p>
        </div>
      </div>

      <div className="err" role="alert">{error}</div>
      <p className="roles-saved" role="status">{saved}</p>

      <form className="card roles-add" onSubmit={add}>
        <div>
          <label htmlFor="add-email">Email</label>
          <input id="add-email" type="email" required placeholder="name@guardrail.tech" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="add-name">Name <span className="sub">Optional</span></label>
          <input id="add-name" type="text" value={addName} onChange={(e) => setAddName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="add-role">Role</label>
          <select id="add-role" value={addRole} onChange={(e) => setAddRole(e.target.value as UserRole)}>
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={busy !== null}>Add person</button>
      </form>

      <div className="roles-bar">
        <input className="search" type="search" aria-label="Search people" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="sub">{people ? `${people.length} people · ${admins} admin${admins === 1 ? '' : 's'}` : ''}</span>
      </div>

      {!people ? (
        <div className="empty">Loading people…</div>
      ) : (
        <div className="table-wrap">
          <table className="roles">
            <thead>
              <tr><th>Person</th><th>Last sign-in</th><th>Role</th></tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const self = p.email === me;
                return (
                  <tr key={p.email}>
                    <td>
                      <b>{p.name || p.email}</b>{self ? <span className="sub"> (you)</span> : null}
                      {p.name ? <div className="sub">{p.email}</div> : null}
                      {p.roleChangedBy ? <div className="sub roles-note">Set by {p.roleChangedBy} on {fmtDate(p.roleChangedAt)}</div> : null}
                    </td>
                    <td className="sub">{p.lastSignInAt ? fmtDate(p.lastSignInAt) : 'Not yet'}</td>
                    <td>
                      <select
                        aria-label={`Role for ${p.name || p.email}`}
                        value={p.role}
                        disabled={self || busy !== null}
                        title={self ? "You can't change your own role" : undefined}
                        onChange={(e) => void save(p.email, e.target.value as UserRole)}
                      >
                        <option value="rep">Rep</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
              {!shown.length ? <tr><td colSpan={3} className="sub">No one matches.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
