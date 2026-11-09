import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SignJWT } from 'jose';
import type { BrowserContext } from '@playwright/test';

function sessionSecret() {
  const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('SESSION_SECRET='));
  if (!line) throw new Error('SESSION_SECRET is missing from .env.local');
  return line.slice('SESSION_SECRET='.length).trim().replace(/^["']|["']$/g, '');
}

// Signs in as Jared (an admin) unless another user is given.
export async function signIn(context: BrowserContext, user = { name: 'Jared Sunday', email: 'jared.sunday@guardrail.tech', oid: 'playwright-local' }) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.oid)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(sessionSecret()));

  await context.addCookies([
    {
      name: 'grt_session',
      value: token,
      url: 'http://127.0.0.1:3000',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
