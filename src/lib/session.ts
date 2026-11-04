import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getAuthConfig } from './auth-config';

export const SESSION_COOKIE = 'grt_session';
export const OAUTH_COOKIE = 'grt_oauth';
export const SESSION_MAX_AGE = 60 * 60 * 8;
const OAUTH_MAX_AGE = 60 * 10;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  oid: string;
};

function secretKey() {
  return new TextEncoder().encode(getAuthConfig().sessionSecret);
}

export async function createSessionToken(user: SessionUser) {
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

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
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

export async function readSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function createOauthStateToken(payload: Record<string, string>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MAX_AGE}s`)
    .sign(secretKey());
}

export async function readOauthStateToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

export function oauthCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OAUTH_MAX_AGE,
  };
}

export function isSecureRequest(request: Request) {
  const proto = request.headers.get('x-forwarded-proto') || '';
  const first = proto.split(',')[0]?.trim();
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return first === 'https' || (!host.includes('localhost') && !host.startsWith('127.'));
}
