import type { SessionUser } from './session';
import { listAllQuotes } from './quotes';
import { store } from './store';

// Who is an admin. Admins pick roles on the Manage roles page; anyone nobody has picked a role
// for falls back to this built-in list (plus ADMIN_EMAILS), and everyone else is a rep.
const DEFAULT_ADMINS = [
  'jared.sunday@guardrail.tech',
  'susan.landaluce@guardrail.tech',
  'dena.lumbang@guardrail.tech',
];

export type UserRole = 'admin' | 'rep';

// Someone the app knows: from signing in, owning a request, or being added on Manage roles.
export type Person = {
  email: string;
  name: string;
  role?: UserRole; // picked on Manage roles; unset means the built-in default
  lastSignInAt?: string | null;
  roleChangedBy?: string;
  roleChangedAt?: string;
};

export type PersonView = Person & { role: UserRole; defaultAdmin: boolean };

const PEOPLE_KEY = 'people';
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

async function readPeople(): Promise<Record<string, Person>> {
  return (await store().getValue<Record<string, Person>>(PEOPLE_KEY)) || {};
}

async function writePeople(people: Record<string, Person>) {
  await store().putValue(PEOPLE_KEY, people);
}

const roleOf = (email: string, person?: Person): UserRole => person?.role || (isAdminEmail(email) ? 'admin' : 'rep');

export async function roleForEmail(email?: string | null): Promise<UserRole> {
  if (!email) return 'rep';
  return roleOf(norm(email), (await readPeople())[norm(email)]);
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
    const people = await readPeople(), email = norm(user.email);
    people[email] = { ...people[email], email, name: user.name || people[email]?.name || '', lastSignInAt: new Date().toISOString() };
    await writePeople(people);
  } catch (err) {
    console.error('[roles] could not record sign-in', err);
  }
}

// Everyone with a role to manage: people who signed in or were added, request owners, and the
// built-in admins. Admins first, then by name.
export async function listPeople(): Promise<PersonView[]> {
  const people = await readPeople();
  const all = new Map<string, Person>();
  for (const email of adminEmails()) all.set(email, { email, name: '' });
  for (const q of await listAllQuotes()) {
    if (q.ownerEmail) all.set(norm(q.ownerEmail), { email: norm(q.ownerEmail), name: q.ownerName || '' });
  }
  for (const [email, p] of Object.entries(people)) all.set(email, { ...all.get(email), ...p, name: p.name || all.get(email)?.name || '' });
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
  if (role === 'rep' && !before.some((p) => p.role === 'admin' && p.email !== email)) throw new RoleError('There has to be at least one admin.');

  const people = await readPeople();
  people[email] = {
    ...people[email],
    email,
    name: people[email]?.name || (name || '').trim() || before.find((p) => p.email === email)?.name || '',
    role,
    roleChangedBy: by.name || by.email,
    roleChangedAt: new Date().toISOString(),
  };
  await writePeople(people);
  return listPeople();
}
