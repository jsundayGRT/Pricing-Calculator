import { getBaseUrl } from '../../lib/auth-config.js';
import { buildLogoutUrl } from '../../lib/oauth.js';
import { redirect, methodNotAllowed } from '../../lib/http.js';
import { clearAuthCookies } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');

  try {
    clearAuthCookies(res, req);
    const loginUrl = `${getBaseUrl(req)}/login`;
    // End the Entra session too so the next sign-in can pick another account.
    return redirect(res, buildLogoutUrl(req, loginUrl));
  } catch (err) {
    console.error('auth/logout', err);
    clearAuthCookies(res, req);
    return redirect(res, '/login');
  }
}
