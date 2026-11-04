import { createHash, randomBytes } from 'node:crypto';
import { getAuthConfig, getRedirectUri } from './auth-config';
import type { SessionUser } from './session';

function base64Url(buf: Buffer) {
  return buf.toString('base64url');
}

export function createPkcePair() {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createState() {
  return base64Url(randomBytes(24));
}

export function buildAuthorizeUrl(request: Request, { state, challenge }: { state: string; challenge: string }) {
  const cfg = getAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(request),
    response_mode: 'query',
    scope: cfg.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${cfg.authorizeUrl}?${params}`;
}

export async function exchangeCode(request: Request, { code, verifier }: { code: string; verifier: string }) {
  const cfg = getAuthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(request),
    code_verifier: verifier,
  });

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error_description || data.error || `token exchange failed (${res.status})`;
    throw new Error(detail);
  }
  return data as { id_token: string };
}

export function claimsFromIdToken(idToken: string) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) throw new Error('Missing id_token from Microsoft');
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

export function userFromClaims(claims: Record<string, unknown>): SessionUser {
  const email = String(claims.preferred_username || claims.email || '').trim().toLowerCase();
  const name = String(claims.name || email || 'Guardrail user').trim();
  const oid = String(claims.oid || claims.sub || '').trim();
  if (!email && !oid) throw new Error('Microsoft account did not return an identity');
  return { id: oid || email, email, name, oid: oid || email };
}

export function assertAllowedUser(user: SessionUser) {
  const { allowedEmailDomain } = getAuthConfig();
  if (!allowedEmailDomain) return;
  const domain = user.email.split('@')[1] || '';
  if (domain !== allowedEmailDomain) {
    throw new Error(`Sign-in is limited to @${allowedEmailDomain} accounts`);
  }
}

export function buildLogoutUrl(request: Request, postLogoutRedirectUri: string) {
  const cfg = getAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
  return `${cfg.logoutUrl}?${params}`;
}
