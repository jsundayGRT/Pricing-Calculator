// Minimal HubSpot REST client for the server. The private app token comes from HUBSPOT_TOKEN
// and never leaves the server. HUBSPOT_DRY_RUN=1 logs every payload and returns fake IDs
// instead of calling HubSpot.

const API = 'https://api.hubapi.com';

export type HubSpotLogger = (message: string, detail?: unknown) => void;

export type HubSpotClientOptions = {
  token?: string;
  dryRun?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: HubSpotLogger;
  maxRetries?: number;
};

export class HubSpotError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'HubSpotError';
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  // 404 returns null instead of throwing (used to check whether something exists)
  allow404?: boolean;
};

export type HubSpotClient = ReturnType<typeof createHubSpotClient>;

export function hubspotEnabled() {
  return process.env.HUBSPOT_DRY_RUN === '1' || !!process.env.HUBSPOT_TOKEN;
}

export function createHubSpotClient(opts: HubSpotClientOptions = {}) {
  const token = opts.token ?? process.env.HUBSPOT_TOKEN ?? '';
  const dryRun = opts.dryRun ?? process.env.HUBSPOT_DRY_RUN === '1';
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log: HubSpotLogger = opts.log ?? ((message, detail) => console.info(`[hubspot] ${message}`, detail ?? ''));
  const maxRetries = opts.maxRetries ?? 5;
  let fakeId = 0;

  async function request<T = Record<string, unknown>>(path: string, ro: RequestOptions = {}): Promise<T> {
    const method = ro.method || 'GET';
    if (dryRun) {
      log(`DRY RUN ${method} ${path}`, ro.form ? '[multipart upload]' : ro.body);
      return dryRunResponse(method, path, ++fakeId) as T;
    }
    if (!token) throw new HubSpotError('HUBSPOT_TOKEN is not set', 0);

    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(ro.form ? {} : { 'Content-Type': 'application/json' }),
        },
        body: ro.form ?? (ro.body === undefined ? undefined : JSON.stringify(ro.body)),
      });
      // 429 (rate limit) and 5xx are worth another try; HubSpot's limits reset within seconds.
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(500 * 2 ** attempt, 10_000);
        log(`${method} ${path} returned ${res.status}; retrying in ${wait} ms`);
        await sleep(wait);
        continue;
      }
      if (res.status === 404 && ro.allow404) return null as T;
      if (res.status === 204) return {} as T;
      const text = await res.text();
      const data = text ? safeJson(text) : {};
      if (!res.ok) {
        const message = (data as { message?: string })?.message || text || res.statusText;
        throw new HubSpotError(`HubSpot ${method} ${path} failed (${res.status}): ${message}`, res.status, data);
      }
      return data as T;
    }
  }

  return { request, dryRun };
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// Plausible stand-ins so a dry run walks the whole sync without a HubSpot account.
function dryRunResponse(method: string, path: string, n: number): unknown {
  const id = `dry-run-${n}`;
  if (path.startsWith('/account-info')) return { portalId: 0, uiDomain: 'app.hubspot.com', timeZone: 'US/Eastern' };
  if (path.startsWith('/crm/v3/pipelines/deals')) {
    return { results: [{ id: process.env.HUBSPOT_PIPELINE_ID || 'default', label: 'Guardrail Sales Pipeline', stages: [{ id: 'appointmentscheduled', label: 'Discovery' }, { id: 'qualifiedtobuy', label: 'Proposal' }] }] };
  }
  if (path.startsWith('/crm/v3/owners')) return { results: [{ id: '42', email: decodeURIComponent(path.match(/email=([^&]*)/)?.[1] || '') }] };
  if (path === '/crm/v3/objects/deals/search') {
    return {
      results: [
        { id: '1001', properties: { dealname: 'Northwind – Platform', amount: '120000', dealstage: 'appointmentscheduled' } },
        { id: '1002', properties: { dealname: 'Contoso – Expansion', amount: '80000', dealstage: 'qualifiedtobuy' } },
      ],
    };
  }
  if (method === 'GET' && path.startsWith('/crm/v3/objects/deals/')) {
    // no name, so the sync keeps the deal name the rep picked
    return { id: path.split('/')[5]?.split('?')[0], properties: {} };
  }
  if (path.startsWith('/crm/v4/objects/deals/') && path.includes('/associations/')) return { results: [] };
  if (path.startsWith('/crm/v3/properties/deals/')) return { name: 'pricing_request_id' };
  if (path.startsWith('/files/v3/files')) return { id };
  if (path.startsWith('/crm/v3/objects/quotes') && method === 'POST') {
    return { id, properties: { hs_quote_link: null } };
  }
  return { id, results: [] };
}
