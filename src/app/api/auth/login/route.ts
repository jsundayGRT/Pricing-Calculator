import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/auth-config';
import { isAdmin } from '@/lib/admin';
import { buildAuthorizeUrl, createPkcePair, createState } from '@/lib/oauth';
import {
  OAUTH_COOKIE,
  createOauthStateToken,
  isSecureRequest,
  oauthCookieOptions,
  readSession,
} from '@/lib/session';

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, getBaseUrl(request)));
}

export async function GET(request: Request) {
  try {
    const session = await readSession();
    if (session) return redirectTo(request, isAdmin(session) ? '/executive' : '/');

    const state = createState();
    const { verifier, challenge } = createPkcePair();
    const token = await createOauthStateToken({ state, verifier });
    const response = NextResponse.redirect(buildAuthorizeUrl(request, { state, challenge }));
    response.cookies.set(OAUTH_COOKIE, token, oauthCookieOptions(isSecureRequest(request)));
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to start Microsoft sign-in';
    return redirectTo(request, `/login?error=${encodeURIComponent(message)}`);
  }
}
