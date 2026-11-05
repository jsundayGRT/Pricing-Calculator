import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/auth-config';
import {
  assertAllowedUser,
  claimsFromIdToken,
  exchangeCode,
  userFromClaims,
} from '@/lib/oauth';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  createSessionToken,
  isSecureRequest,
  oauthCookieOptions,
  readOauthStateToken,
  sessionCookieOptions,
} from '@/lib/session';

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, getBaseUrl(request)));
}

function signedInHtml(destination: string) {
  const next = JSON.stringify(destination);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Signing in…</title></head><body><script>location.replace(${next})</script></body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    if (error) throw new Error(errorDescription || error);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('Missing authorization code from Microsoft');

    const jar = await cookies();
    const oauthToken = jar.get(OAUTH_COOKIE)?.value;
    const oauth = oauthToken ? await readOauthStateToken(oauthToken) : null;

    if (!oauth?.state || !oauth?.verifier || oauth.state !== state) {
      throw new Error('Sign-in session expired. Please try again.');
    }

    const tokens = await exchangeCode(request, { code, verifier: String(oauth.verifier) });
    const claims = claimsFromIdToken(tokens.id_token);
    const user = userFromClaims(claims);
    assertAllowedUser(user);

    const sessionToken = await createSessionToken(user);
    // Everyone, admins included, lands on the Dashboard welcome screen.
    const destination = '/';
    // 200 page, not a redirect. Browsers often drop a cookie set on the
    // cross-site bounce back from Microsoft, so the next tab looks signed out.
    const response = new NextResponse(signedInHtml(destination), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(isSecureRequest(request)));
    response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(isSecureRequest(request)), maxAge: 0 });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Microsoft sign-in failed';
    const response = redirectTo(request, `/login?error=${encodeURIComponent(message)}`);
    response.cookies.set(OAUTH_COOKIE, '', { ...oauthCookieOptions(isSecureRequest(request)), maxAge: 0 });
    return response;
  }
}
