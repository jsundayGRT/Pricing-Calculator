import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'grt_session';

async function hasValidSession(request: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = await hasValidSession(request);

  if (pathname.startsWith('/api/auth/')) return NextResponse.next();
  if (pathname === '/login') {
    if (authed) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  if (!authed) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png).*)'],
};
