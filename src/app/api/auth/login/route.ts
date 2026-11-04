import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, createPkcePair, createState } from '@/lib/oauth';
import {
  OAUTH_COOKIE,
  createOauthStateToken,
  isSecureRequest,
  oauthCookieOptions,
  readSession,
} from '@/lib/session';

export async function GET(request: Request) {
  try {
    const session = await readSession();
    if (session) return NextResponse.redirect(new URL('/', request.url));

    const state = createState();
    const { verifier, challenge } = createPkcePair();
    const token = await createOauthStateToken({ state, verifier });
    const jar = await cookies();
    jar.set(OAUTH_COOKIE, token, oauthCookieOptions(isSecureRequest(request)));

    return NextResponse.redirect(buildAuthorizeUrl(request, { state, challenge }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to start Microsoft sign-in';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
  }
}
