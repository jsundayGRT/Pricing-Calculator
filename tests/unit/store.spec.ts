import { expect, test } from '@playwright/test';
import {
  approveQuote,
  deleteQuoteForUser,
  getQuoteById,
  listAllQuotes,
  readQuotePdf,
  saveQuotePdf,
  upsertQuote,
} from '../../src/lib/quotes';
import { usingRedis } from '../../src/lib/store';

// The Upstash Redis store (used on Vercel), against an in-memory fake of Upstash's REST API.

const realFetch = globalThis.fetch;
let hashes: Map<string, Map<string, string>>;
let strings: Map<string, string>;

test.beforeEach(() => {
  process.env.KV_REST_API_URL = 'https://fake-upstash.example';
  process.env.KV_REST_API_TOKEN = 'tok';
  hashes = new Map();
  strings = new Map();
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://fake-upstash.example');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const [cmd, key, ...rest] = JSON.parse(String(init?.body)) as string[];
    const h = hashes.get(key) ?? new Map<string, string>();
    hashes.set(key, h);
    switch (cmd) {
      case 'HSET': h.set(rest[0], rest[1]); return Response.json({ result: 1 });
      case 'HGET': return Response.json({ result: h.get(rest[0]) ?? null });
      case 'HGETALL': return Response.json({ result: [...h.entries()].flat() });
      case 'HDEL': return Response.json({ result: h.delete(rest[0]) ? 1 : 0 });
      case 'SET': strings.set(key, rest[0]); return Response.json({ result: 'OK' });
      case 'GET': return Response.json({ result: strings.get(key) ?? null });
      case 'DEL': return Response.json({ result: strings.delete(key) ? 1 : 0 });
      default: return Response.json({ error: `unknown ${cmd}` }, { status: 400 });
    }
  }) as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

test('requests, decisions and PDFs are kept in Redis', async () => {
  expect(usingRedis()).toBe(true);
  const record = await upsertQuote({
    ownerId: 'u1',
    ownerEmail: 'avery@guardrail.tech',
    ownerName: 'Avery Rep',
    snapshot: { requestId: 'GRT-R1', version: 1, customerName: 'Northwind', status: 'DEAL REVIEW' },
  });
  await saveQuotePdf(record.id, new TextEncoder().encode('%PDF-1.7 hi'));

  // Same request and version again: updated in place, not duplicated.
  await upsertQuote({
    ownerId: 'u1',
    ownerEmail: 'avery@guardrail.tech',
    ownerName: 'Avery Rep',
    snapshot: { requestId: 'GRT-R1', version: 1, customerName: 'Northwind Inc', status: 'DEAL REVIEW' },
  });
  expect((await listAllQuotes()).map((q) => q.customerName)).toEqual(['Northwind Inc']);

  await approveQuote(record.id, { name: 'Susan', email: 's@guardrail.tech' });
  expect((await getQuoteById(record.id))!.status).toBe('APPROVED');
  expect(new TextDecoder().decode((await readQuotePdf(record.id))!)).toBe('%PDF-1.7 hi');

  expect(await deleteQuoteForUser('someone-else', record.id)).toBe(false);
  expect(await deleteQuoteForUser('u1', record.id)).toBe(true);
  expect(await getQuoteById(record.id)).toBeNull();
  expect(await readQuotePdf(record.id)).toBeNull();
});
