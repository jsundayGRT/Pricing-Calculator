import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
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
  readOauthStateToken,
  sessionCookieOptions,
} from '@/lib/session';

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
    jar.delete(OAUTH_COOKIE);

    if (!oauth?.state || !oauth?.verifier || oauth.state !== state) {
      throw new Error('Sign-in session expired. Please try again.');
    }

    const tokens = await exchangeCode(request, { code, verifier: String(oauth.verifier) });
    const claims = claimsFromIdToken(tokens.id_token);
    const user = userFromClaims(claims);
    assertAllowedUser(user);

    const sessionToken = await createSessionToken(user);
    jar.set(SESSION_COOKIE, sessionToken, sessionCookieOptions(isSecureRequest(request)));

    return NextResponse.redirect(new URL('/', request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Microsoft sign-in failed';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }
}
