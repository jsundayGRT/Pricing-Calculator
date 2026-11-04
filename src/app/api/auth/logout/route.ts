import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/auth-config';
import { buildLogoutUrl } from '@/lib/oauth';
import { OAUTH_COOKIE, SESSION_COOKIE } from '@/lib/session';

export async function GET(request: Request) {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(OAUTH_COOKIE);

  try {
    const loginUrl = `${getBaseUrl(request)}/login`;
    return NextResponse.redirect(buildLogoutUrl(request, loginUrl));
  } catch {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export async function POST(request: Request) {
  return GET(request);
}
