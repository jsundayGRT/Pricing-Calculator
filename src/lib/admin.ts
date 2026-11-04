import type { SessionUser } from './session';

const DEFAULT_ADMINS = ['jared.sunday@guardrail.tech'];

export function adminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ADMINS, ...fromEnv])];
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export function isAdmin(user?: SessionUser | null) {
  return !!user && isAdminEmail(user.email);
}

export type UserRole = 'admin' | 'rep';

export function roleFor(user: SessionUser): UserRole {
  return isAdmin(user) ? 'admin' : 'rep';
}
