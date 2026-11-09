import { NextResponse } from 'next/server';
import { isAdmin, listPeople, RoleError, setRole } from '@/lib/admin';
import { readSession } from '@/lib/session';

// GET  → everyone with a role (admins only)
// POST { email, role, name? } → make someone an admin or a rep (admins only)
export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ people: await listPeople() });
}

export async function POST(request: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
  if (!(await isAdmin(session))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const body = await request.json();
    const people = await setRole(session, String(body?.email || ''), body?.role, typeof body?.name === 'string' ? body.name : undefined);
    return NextResponse.json({ people });
  } catch (err) {
    if (err instanceof RoleError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error('[roles] could not change a role', err);
    return NextResponse.json({ error: 'Could not save the role. Try again.' }, { status: 500 });
  }
}
