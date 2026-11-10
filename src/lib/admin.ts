import type { SessionUser } from './session';
import { listActivity } from './activity';
import { listAllQuotes } from './quotes';
import { readSavedRoles, ROLES_KEY, type RoleEntry, type UserRole } from './access';
import { store, usingRedis } from './store';

// Who is an admin. Admins pick roles on the Manage roles page; anyone nobody has picked a role
// for falls back to this built-in list (plus ADMIN_EMAILS), and everyone else is a rep.
const DEFAULT_ADMINS = [
  'jared.sunday@guardrail.tech',
  'susan.landaluce@guardrail.tech',
  'dena.lumbang@guardrail.tech',
];

export type { UserRole };

// Someone the app knows: from signing in, owning a request, or being added on Manage roles.
export type Person = {
  email: string;
  name: string;
  role?: UserRole; // picked on Manage roles; unset means the built-in default
  lastSignInAt?: string | null;
  lastSeenAt?: string | null; // last time they opened a page in the app
  roleChangedBy?: string;
  roleChangedAt?: string;
  removedAt?: string; // removed: can't sign in until an admin saves a role for them again
};

export type PersonView = Person & { role: UserRole; defaultAdmin: boolean };

// Roles and activity are saved separately, so a page view recording activity can never
// overwrite a role an admin is changing at the same moment. ('people' is the older combined
// record, still read for the roles saved in it.)
const SEEN_KEY = 'seen', LEGACY_KEY = 'people';
type SeenEntry = { name?: string; lastSignInAt?: string | null; lastSeenAt?: string | null };
const norm = (email: string) => email.trim().toLowerCase();

export function adminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ADMINS, ...fromEnv])];
}

// On the built-in admin list (the role before anyone changes it).
export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return adminEmails().includes(norm(email));
}

async function readRoles(): Promise<Record<string, RoleEntry>> {
  const saved = await readSavedRoles();
  if (saved) return saved;
  const legacy = (await store().getValue<Record<string, Person>>(LEGACY_KEY)) || {};
  return Object.fromEntries(Object.entries(legacy).filter(([, p]) => p.role).map(([e, p]) => [e, { role: p.role as UserRole, name: p.name, roleChangedBy: p.roleChangedBy, roleChangedAt: p.roleChangedAt }]));
}

async function readSeen(): Promise<Record<string, SeenEntry>> {
  const saved = await store().getValue<Record<string, SeenEntry>>(SEEN_KEY);
  if (saved) return saved;
  const legacy = (await store().getValue<Record<string, Person>>(LEGACY_KEY)) || {};
  return Object.fromEntries(Object.entries(legacy).map(([e, p]) => [e, { name: p.name, lastSignInAt: p.lastSignInAt, lastSeenAt: p.lastSeenAt }]));
}

const roleOf = (email: string, entry?: { role?: UserRole; removedAt?: string }): UserRole =>
  entry?.removedAt ? 'rep' : entry?.role || (isAdminEmail(email) ? 'admin' : 'rep');

export async function roleForEmail(email?: string | null): Promise<UserRole> {
  if (!email) return 'rep';
  return roleOf(norm(email), (await readRoles())[norm(email)]);
}

export async function isAdmin(user?: SessionUser | null) {
  return !!user?.email && (await roleForEmail(user.email)) === 'admin';
}

export async function roleFor(user: SessionUser): Promise<UserRole> {
  return roleForEmail(user.email);
}

// Remembered at sign-in, so the person shows up on Manage roles. Never blocks signing in.
export async function recordSignIn(user: { name: string; email: string }) {
  if (!user.email) return;
  try {
    const seen = await readSeen(), email = norm(user.email), now = new Date().toISOString();
    seen[email] = { ...seen[email], name: user.name || seen[email]?.name || '', lastSignInAt: now, lastSeenAt: now };
    await store().putValue(SEEN_KEY, seen);
  } catch (err) {
    console.error('[roles] could not record sign-in', err);
  }
}

// A sign-in lasts hours, so Manage roles shows when someone last opened the app, not only when
// they last signed in. Saved at most every few minutes per person. Never blocks the page.
const SEEN_EVERY_MS = 10 * 60 * 1000;
export async function recordSeen(user?: { name: string; email: string } | null) {
  if (!user?.email) return;
  try {
    const seen = await readSeen(), email = norm(user.email), p = seen[email];
    const last = Date.parse(p?.lastSeenAt || p?.lastSignInAt || '');
    if (Number.isFinite(last) && Date.now() - last < SEEN_EVERY_MS) return;
    seen[email] = { ...p, name: user.name || p?.name || '', lastSeenAt: new Date().toISOString() };
    await store().putValue(SEEN_KEY, seen);
  } catch (err) {
    console.error('[roles] could not record activity', err);
  }
}

// On Vercel without Upstash Redis, roles and activity live in per-instance temporary files.
export function rolesStorageIsTemporary() {
  return !!process.env.VERCEL && !usingRedis();
}

// Everyone with a role to manage: people who signed in or were added, request owners, and the
// built-in admins. Admins first, then by name.
export async function listPeople(): Promise<PersonView[]> {
  const [roles, seen, quotes, events] = await Promise.all([readRoles(), readSeen(), listAllQuotes(), listActivity().catch(() => [])]);
  const all = new Map<string, Person>();
  const merge = (email: string, p: Partial<Person>) => {
    const was = all.get(email);
    all.set(email, { ...was, ...p, email, name: p.name || was?.name || '' });
  };
  // Last active is the latest of: opening the app, signing in, locking a request, or anything in
  // the activity log (approving, declining, noting). The last two also cover the time before
  // page visits were recorded.
  const latest = new Map<string, string>();
  const saw = (email: string | undefined, at: string | null | undefined) => {
    if (!email || !at) return;
    const e = norm(email);
    if (!latest.has(e) || at > (latest.get(e) as string)) latest.set(e, at);
  };
  for (const email of adminEmails()) merge(email, {});
  for (const q of quotes) if (q.ownerEmail) { merge(norm(q.ownerEmail), { name: q.ownerName || '' }); saw(q.ownerEmail, q.lockedAt); }
  for (const ev of events) saw(ev.email, ev.at);
  for (const [email, r] of Object.entries(roles)) merge(email, { name: r.name, role: r.role, roleChangedBy: r.roleChangedBy, roleChangedAt: r.roleChangedAt, removedAt: r.removedAt });
  for (const [email, x] of Object.entries(seen)) { merge(email, { name: x.name, lastSignInAt: x.lastSignInAt }); saw(email, x.lastSeenAt); saw(email, x.lastSignInAt); }
  for (const [email, at] of latest) if (all.has(email)) all.set(email, { ...(all.get(email) as Person), lastSeenAt: at });
  return [...all.values()]
    .map((p) => ({ ...p, role: roleOf(p.email, p), defaultAdmin: isAdminEmail(p.email) }))
    .sort((a, b) => (a.role === b.role ? (a.name || a.email).localeCompare(b.name || b.email) : a.role === 'admin' ? -1 : 1));
}

export class RoleError extends Error {}

export async function setRole(by: SessionUser, emailIn: string, role: UserRole, name?: string) {
  const email = norm(String(emailIn || ''));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RoleError('Enter a valid email address.');
  if (role !== 'admin' && role !== 'rep') throw new RoleError('Choose Admin or Rep.');
  const domain = (process.env.AZURE_AD_ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase();
  if (domain && !email.endsWith('@' + domain)) throw new RoleError(`Only @${domain} accounts can sign in.`);
  if (email === norm(by.email) && role !== 'admin') throw new RoleError("You can't remove your own admin access. Ask another admin.");
  const before = await listPeople();
  if (role === 'rep' && !before.some((p) => p.role === 'admin' && !p.removedAt && p.email !== email)) throw new RoleError('There has to be at least one admin.');

  // saving a role for a removed person lets them back in
  const roles = await readRoles();
  roles[email] = {
    role,
    name: roles[email]?.name || (name || '').trim() || before.find((p) => p.email === email)?.name || '',
    roleChangedBy: by.name || by.email,
    roleChangedAt: new Date().toISOString(),
  };
  await store().putValue(ROLES_KEY, roles);
  return listPeople();
}

// Removes someone: they're signed out and can't sign in again, and lose admin access (even a
// built-in admin). Their requests stay. Saving a role for them on Manage roles lets them back in.
export async function removePerson(by: SessionUser, emailIn: string) {
  const email = norm(String(emailIn || ''));
  if (!email) throw new RoleError('Choose a person to remove.');
  if (email === norm(by.email)) throw new RoleError("You can't remove yourself. Ask another admin.");
  const before = await listPeople();
  const person = before.find((p) => p.email === email);
  if (!person || person.removedAt) throw new RoleError('That person is not on the list.');
  if (person.role === 'admin' && !before.some((p) => p.role === 'admin' && !p.removedAt && p.email !== email)) throw new RoleError('There has to be at least one admin.');

  const now = new Date().toISOString();
  const roles = await readRoles();
  roles[email] = { role: 'rep', name: person.name, roleChangedBy: by.name || by.email, roleChangedAt: now, removedAt: now };
  await store().putValue(ROLES_KEY, roles);
  const seen = await readSeen();
  if (seen[email]) { delete seen[email]; await store().putValue(SEEN_KEY, seen); }
  return listPeople();
}
