import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/auth-config';
import { readSession } from '@/lib/session';

export async function GET(request: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login', getBaseUrl(request)));
  }

  const html = readFileSync(path.join(process.cwd(), 'content', 'calculator.html'));
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
