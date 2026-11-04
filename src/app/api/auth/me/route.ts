import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';

export async function GET() {
  try {
    const session = await readSession();
    if (!session) return NextResponse.json({ error: 'signed out' }, { status: 401 });
    return NextResponse.json({
      id: session.id,
      name: session.name,
      email: session.email,
    });
  } catch {
    return NextResponse.json({ error: 'signed out' }, { status: 401 });
  }
}
