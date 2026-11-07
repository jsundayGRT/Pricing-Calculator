// Where locked requests and their quote PDFs live.
//
// On Vercel the file system is per-instance and temporary, so a request locked on one instance
// can be missing on the next (a Slack button pressed an hour later, for example). With Upstash
// Redis connected (Vercel → Storage → Upstash, which sets KV_REST_API_URL and KV_REST_API_TOKEN),
// everything is kept there instead. Without it, a JSON file is used: fine locally and in tests.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Store = {
  all<T>(): Promise<T[]>;
  get<T>(id: string): Promise<T | null>;
  put<T extends { id: string }>(record: T): Promise<void>;
  remove(id: string): Promise<boolean>;
  putPdf(id: string, bytes: Uint8Array): Promise<void>;
  getPdf(id: string): Promise<Uint8Array | null>;
  removePdf(id: string): Promise<void>;
  // The activity log: newest first, capped at EVENT_LIMIT.
  addEvent<T>(event: T): Promise<void>;
  events<T>(): Promise<T[]>;
};

export const EVENT_LIMIT = 1000;

const QUOTES_KEY = 'grt:quotes';
const EVENTS_KEY = 'grt:events';
const pdfKey = (id: string) => `grt:pdf:${id}`;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export function usingRedis() {
  return !!redisConfig();
}

let override: Store | null = null;
// For tests: swap in another store.
export function setStoreForTests(store: Store | null) {
  override = store;
}

export function store(): Store {
  if (override) return override;
  const redis = redisConfig();
  return redis ? redisStore(redis.url, redis.token) : fileStore();
}

// Upstash's REST API: one Redis command per request, as a JSON array.
function redisStore(url: string, token: string): Store {
  async function cmd<T>(...args: string[]): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
    if (!res.ok || data.error) throw new Error(`Redis ${args[0]} failed: ${data.error || res.status}`);
    return data.result as T;
  }
  return {
    async all<T>() {
      // HGETALL returns [field, value, field, value, ...]
      const flat = (await cmd<string[] | null>('HGETALL', QUOTES_KEY)) || [];
      const out: T[] = [];
      for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]) as T);
      return out;
    },
    async get<T>(id: string) {
      const raw = await cmd<string | null>('HGET', QUOTES_KEY, id);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async put(record) {
      await cmd('HSET', QUOTES_KEY, record.id, JSON.stringify(record));
    },
    async remove(id) {
      return (await cmd<number>('HDEL', QUOTES_KEY, id)) > 0;
    },
    async putPdf(id, bytes) {
      await cmd('SET', pdfKey(id), Buffer.from(bytes).toString('base64'));
    },
    async getPdf(id) {
      const raw = await cmd<string | null>('GET', pdfKey(id));
      return raw ? new Uint8Array(Buffer.from(raw, 'base64')) : null;
    },
    async removePdf(id) {
      await cmd('DEL', pdfKey(id));
    },
    async addEvent(event) {
      await cmd('LPUSH', EVENTS_KEY, JSON.stringify(event));
      await cmd('LTRIM', EVENTS_KEY, '0', String(EVENT_LIMIT - 1));
    },
    async events<T>() {
      const raw = (await cmd<string[] | null>('LRANGE', EVENTS_KEY, '0', String(EVENT_LIMIT - 1))) || [];
      return raw.map((x) => JSON.parse(x) as T);
    },
  };
}

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return '/tmp';
  return path.join(process.cwd(), 'data');
}

function fileStore(): Store {
  const file = !process.env.DATA_DIR && process.env.VERCEL
    ? path.join('/tmp', 'grt-quotes.json')
    : path.join(dataDir(), 'quotes.json');
  const eventsFile = path.join(path.dirname(file), file.endsWith('grt-quotes.json') ? 'grt-events.json' : 'events.json');
  const pdfPath = (id: string) => path.join(dataDir(), 'quote-pdfs', `${id.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`);

  function read(): { id: string }[] {
    try {
      if (!existsSync(file)) return [];
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { quotes?: { id: string }[] };
      return Array.isArray(parsed.quotes) ? parsed.quotes : [];
    } catch {
      return [];
    }
  }
  function write(quotes: { id: string }[]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ quotes }, null, 2), 'utf8');
  }

  return {
    async all<T>() {
      return read() as T[];
    },
    async get<T>(id: string) {
      return (read().find((q) => q.id === id) as T) || null;
    },
    async put(record) {
      write([record, ...read().filter((q) => q.id !== record.id)]);
    },
    async remove(id) {
      const quotes = read();
      const kept = quotes.filter((q) => q.id !== id);
      if (kept.length === quotes.length) return false;
      write(kept);
      return true;
    },
    async putPdf(id, bytes) {
      const p = pdfPath(id);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, bytes);
    },
    async getPdf(id) {
      try {
        return readFileSync(pdfPath(id));
      } catch {
        return null;
      }
    },
    async removePdf(id) {
      try { unlinkSync(pdfPath(id)); } catch { /* no PDF saved */ }
    },
    async addEvent(event) {
      const list = await this.events();
      mkdirSync(path.dirname(eventsFile), { recursive: true });
      writeFileSync(eventsFile, JSON.stringify({ events: [event, ...list].slice(0, EVENT_LIMIT) }, null, 2), 'utf8');
    },
    async events<T>() {
      try {
        if (!existsSync(eventsFile)) return [];
        const parsed = JSON.parse(readFileSync(eventsFile, 'utf8')) as { events?: T[] };
        return Array.isArray(parsed.events) ? parsed.events : [];
      } catch {
        return [];
      }
    },
  };
}
