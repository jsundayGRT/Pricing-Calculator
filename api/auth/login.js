import { buildAuthorizeUrl, createPkcePair, createState } from '../../lib/oauth.js';
import { redirect, methodNotAllowed } from '../../lib/http.js';
import { createOauthStateToken, setOauthCookie, readSession } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const session = await readSession(req);
    if (session) return redirect(res, '/');

    const state = createState();
    const { verifier, challenge } = createPkcePair();
    const token = await createOauthStateToken({ state, verifier });
    setOauthCookie(res, token, req);

    return redirect(res, buildAuthorizeUrl(req, { state, challenge }));
  } catch (err) {
    console.error('auth/login', err);
    const msg = encodeURIComponent(err.message || 'Unable to start Microsoft sign-in');
    return redirect(res, `/login?error=${msg}`);
  }
}
