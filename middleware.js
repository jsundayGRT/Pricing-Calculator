import { jwtVerify } from 'jose';

const SESSION_COOKIE = 'grt_session';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function next() {
  return new Response(null, {
    headers: { 'x-middleware-next': '1' },
  });
}

async function hasValidSession(request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Public auth + static asset paths — never require a session.
  if (
    pathname.startsWith('/api/auth/')
    || pathname === '/login'
    || pathname === '/login.html'
    || pathname === '/logo.png'
    || pathname === '/favicon.ico'
  ) {
    if ((pathname === '/login' || pathname === '/login.html') && await hasValidSession(request)) {
      url.pathname = '/';
      url.search = '';
      return Response.redirect(url, 302);
    }
    return next();
  }

  if (!(await hasValidSession(request))) {
    url.pathname = '/login';
    url.search = '';
    return Response.redirect(url, 302);
  }

  return next();
}

export const config = {
  matcher: ['/((?!_next/|_vercel/|.*\\..*).*)', '/', '/index.html', '/login', '/login.html'],
};
