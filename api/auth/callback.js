import {
  assertAllowedUser,
  claimsFromIdToken,
  exchangeCode,
  userFromClaims,
} from '../../lib/oauth.js';
import { redirect, methodNotAllowed } from '../../lib/http.js';
import {
  clearCookie,
  OAUTH_COOKIE,
  readOauthState,
  setSessionCookie,
} from '../../lib/session.js';

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }
  const list = Array.isArray(existing) ? existing : [existing];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const url = new URL(req.url, 'http://localhost');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    if (error) {
      throw new Error(errorDescription || error);
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('Missing authorization code from Microsoft');

    const oauth = await readOauthState(req);
    if (!oauth?.state || !oauth?.verifier || oauth.state !== state) {
      throw new Error('Sign-in session expired. Please try again.');
    }

    appendSetCookie(res, clearCookie(OAUTH_COOKIE, req));

    const tokens = await exchangeCode(req, { code, verifier: String(oauth.verifier) });
    const claims = claimsFromIdToken(tokens.id_token);
    const user = userFromClaims(claims);
    assertAllowedUser(user);

    await setSessionCookie(res, user, req);
    return redirect(res, '/');
  } catch (err) {
    console.error('auth/callback', err);
    const msg = encodeURIComponent(err.message || 'Microsoft sign-in failed');
    return redirect(res, `/login?error=${msg}`);
  }
}
