import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/auth-config';
import { OAUTH_COOKIE, SESSION_COOKIE } from '@/lib/session';

// Signs out of the calculator only. It used to sign out of Microsoft as well, which also ended
// Outlook/Teams in the browser and made the next sign-in ask for the Microsoft password again.
export async function GET(request: Request) {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(OAUTH_COOKIE);
  return NextResponse.redirect(new URL('/login', getBaseUrl(request)));
}

export async function POST(request: Request) {
  return GET(request);
}
