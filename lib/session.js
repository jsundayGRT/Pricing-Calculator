import { SignJWT, jwtVerify } from 'jose';
import { getAuthConfig } from './auth-config.js';

export const SESSION_COOKIE = 'grt_session';
export const OAUTH_COOKIE = 'grt_oauth';
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours
const OAUTH_MAX_AGE = 60 * 10; // 10 minutes

function secretKey() {
  return new TextEncoder().encode(getAuthConfig().sessionSecret);
}

function isSecureRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || '';
  const first = (Array.isArray(proto) ? proto[0] : proto).split(',')[0]?.trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return first === 'https' || (!String(host).includes('localhost') && !String(host).startsWith('127.'));
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function serializeCookie(name, value, { maxAge, path = '/', httpOnly = true, sameSite = 'Lax', secure = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (typeof maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

export function clearCookie(name, req) {
  return serializeCookie(name, '', { maxAge: 0, secure: isSecureRequest(req) });
}

export async function createSessionToken(user) {
  return new SignJWT({
    name: user.name,
    email: user.email,
    oid: user.oid,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.oid || user.email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return {
      id: String(payload.sub || ''),
      name: String(payload.name || ''),
      email: String(payload.email || ''),
      oid: String(payload.oid || payload.sub || ''),
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(res, user, req) {
  const token = await createSessionToken(user);
  appendSetCookie(res, serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_MAX_AGE,
    secure: isSecureRequest(req),
  }));
}

export async function createOauthStateToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MAX_AGE}s`)
    .sign(secretKey());
}

export async function readOauthState(req) {
  const token = parseCookies(req)[OAUTH_COOKIE];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export function setOauthCookie(res, token, req) {
  appendSetCookie(res, serializeCookie(OAUTH_COOKIE, token, {
    maxAge: OAUTH_MAX_AGE,
    secure: isSecureRequest(req),
  }));
}

export function clearAuthCookies(res, req) {
  appendSetCookie(res, clearCookie(SESSION_COOKIE, req));
  appendSetCookie(res, clearCookie(OAUTH_COOKIE, req));
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader?.('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }
  const list = Array.isArray(existing) ? existing : [existing];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export { SESSION_MAX_AGE };
