import { sendJson, methodNotAllowed } from '../../lib/http.js';
import { readSession } from '../../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const session = await readSession(req);
    if (!session) return sendJson(res, 401, { error: 'signed out' });

    return sendJson(res, 200, {
      id: session.id,
      name: session.name,
      email: session.email,
    });
  } catch (err) {
    console.error('auth/me', err);
    return sendJson(res, 401, { error: 'signed out' });
  }
}
