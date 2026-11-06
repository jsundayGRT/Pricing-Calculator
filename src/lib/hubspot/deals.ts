// Deals for the pricing request form, limited to the Guardrail Sales Pipeline. Reps pick from
// the open deals they own in HubSpot (matched by their Guardrail email); admins can also search
// every deal in the pipeline.

import { createHubSpotClient, HubSpotError, type HubSpotClient } from './client';

const PIPELINE_LABEL = 'Guardrail Sales Pipeline';
const OWNER_TTL_MS = 10 * 60 * 1000;

export type DealHit = { id: string; name: string; amount: number | null; stage: string | null };

type Pipeline = { id: string; label: string; stages?: { id: string; label: string }[] };
let pipelineCache: { id: string; stages: Record<string, string> } | null = null;
const ownerCache = new Map<string, { id: string | null; at: number }>();

async function pipeline(client: HubSpotClient) {
  if (pipelineCache) return pipelineCache;
  const data = await client.request<{ results?: Pipeline[] }>('/crm/v3/pipelines/deals');
  const results = data.results || [];
  const match = process.env.HUBSPOT_PIPELINE_ID
    ? results.find((p) => p.id === process.env.HUBSPOT_PIPELINE_ID) || { id: process.env.HUBSPOT_PIPELINE_ID, label: PIPELINE_LABEL }
    : results.find((p) => p.label.trim().toLowerCase() === PIPELINE_LABEL.toLowerCase());
  if (!match) throw new Error(`No HubSpot deal pipeline is named "${PIPELINE_LABEL}". Set HUBSPOT_PIPELINE_ID.`);
  const found = { id: match.id, stages: Object.fromEntries((match.stages || []).map((s) => [s.id, s.label])) };
  if (!client.dryRun) pipelineCache = found;
  return found;
}

type SearchResult = { results?: { id: string; properties: Record<string, string | null> }[]; paging?: { next?: { after?: string } } };

function toHits(data: SearchResult, stages: Record<string, string>): DealHit[] {
  return (data.results || []).map((r) => ({
    id: String(r.id),
    name: r.properties.dealname || `Deal ${r.id}`,
    amount: r.properties.amount ? Number(r.properties.amount) : null,
    stage: r.properties.dealstage ? stages[r.properties.dealstage] || r.properties.dealstage : null,
  }));
}

export async function searchDeals(query: string, client: HubSpotClient = createHubSpotClient()): Promise<DealHit[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const p = await pipeline(client);
  const data = await client.request<SearchResult>('/crm/v3/objects/deals/search', {
    method: 'POST',
    body: {
      query: q,
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: p.id }] }],
      properties: ['dealname', 'amount', 'dealstage'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 10,
    },
  });
  const hits = toHits(data, p.stages);
  // The dry-run stub returns a fixed list; narrow it so the picker still behaves.
  return client.dryRun ? hits.filter((h) => h.name.toLowerCase().includes(q.toLowerCase())) : hits;
}

// The HubSpot owner for a Guardrail email, or null when the person isn't a HubSpot user.
export async function ownerIdForEmail(email: string, client: HubSpotClient = createHubSpotClient()): Promise<string | null> {
  const key = email.trim().toLowerCase();
  const hit = ownerCache.get(key);
  if (hit && Date.now() - hit.at < OWNER_TTL_MS) return hit.id;
  const data = await client.request<{ results?: { id: string; email?: string; archived?: boolean }[] }>(
    `/crm/v3/owners?email=${encodeURIComponent(key)}&limit=1&archived=false`,
  );
  const owner = (data.results || []).find((o) => !o.archived && (!o.email || o.email.toLowerCase() === key));
  const id = owner ? String(owner.id) : null;
  if (!client.dryRun) ownerCache.set(key, { id, at: Date.now() });
  return id;
}

export type MyDeals =
  | { status: 'ok'; deals: DealHit[] }
  | { status: 'no-owner'; deals: [] }
  // the HubSpot key can't read owners (missing the crm.objects.owners.read scope)
  | { status: 'owners-unavailable'; deals: [] };

// Open deals owned by this person in the Guardrail Sales Pipeline, most recently updated first.
export async function dealsForOwnerEmail(email: string, client: HubSpotClient = createHubSpotClient()): Promise<MyDeals> {
  let ownerId: string | null;
  try {
    ownerId = await ownerIdForEmail(email, client);
  } catch (err) {
    if (err instanceof HubSpotError && (err.status === 401 || err.status === 403)) return { status: 'owners-unavailable', deals: [] };
    throw err;
  }
  if (!ownerId) return { status: 'no-owner', deals: [] };
  const p = await pipeline(client);
  const deals: DealHit[] = [];
  let after: string | undefined;
  // two pages of 100 cover any rep's open pipeline
  for (let page = 0; page < 2; page++) {
    const data = await client.request<SearchResult>('/crm/v3/objects/deals/search', {
      method: 'POST',
      body: {
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: p.id },
            { propertyName: 'hubspot_owner_id', operator: 'EQ', value: ownerId },
            { propertyName: 'hs_is_closed', operator: 'NEQ', value: 'true' },
          ],
        }],
        properties: ['dealname', 'amount', 'dealstage'],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        limit: 100,
        ...(after ? { after } : {}),
      },
    });
    deals.push(...toHits(data, p.stages));
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return { status: 'ok', deals };
}

export function resetDealCachesForTests() {
  pipelineCache = null;
  ownerCache.clear();
}
