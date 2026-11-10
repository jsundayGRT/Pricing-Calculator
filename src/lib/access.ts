// Roles as saved on Manage roles, and whether someone was removed (which blocks them from the
// app). Kept apart from admin.ts so the session check can read it without loading the rest.

import { store } from './store';

export type UserRole = 'admin' | 'rep';

// removedAt: taken off Manage roles; they can't sign in or use the app until an admin lets them back.
export type RoleEntry = { role: UserRole; name?: string; roleChangedBy?: string; roleChangedAt?: string; removedAt?: string };

export const ROLES_KEY = 'roles';
const norm = (email: string) => email.trim().toLowerCase();

export async function readSavedRoles() {
  return store().getValue<Record<string, RoleEntry>>(ROLES_KEY);
}

export async function isBlocked(email?: string | null) {
  if (!email) return false;
  try {
    return !!(await readSavedRoles())?.[norm(email)]?.removedAt;
  } catch (err) {
    // the store being unreachable shouldn't lock everyone out
    console.error('[access] could not check whether someone was removed', err);
    return false;
  }
}

export const BLOCKED_MESSAGE = 'This account no longer has access to the Pricing Calculator. Ask an admin to let you back in.';
