// Deal search for the pricing request form, limited to the Guardrail Sales Pipeline.

import { createHubSpotClient, type HubSpotClient } from './client';

const PIPELINE_LABEL = 'Guardrail Sales Pipeline';

export type DealHit = { id: string; name: string; amount: number | null; stage: string | null };

let pipelineIdCache: string | null = null;

async function pipelineId(client: HubSpotClient) {
  if (process.env.HUBSPOT_PIPELINE_ID) return process.env.HUBSPOT_PIPELINE_ID;
  if (pipelineIdCache) return pipelineIdCache;
  const data = await client.request<{ results?: { id: string; label: string }[] }>('/crm/v3/pipelines/deals');
  const match = (data.results || []).find((p) => p.label.trim().toLowerCase() === PIPELINE_LABEL.toLowerCase());
  if (!match) throw new Error(`No HubSpot deal pipeline is named "${PIPELINE_LABEL}". Set HUBSPOT_PIPELINE_ID.`);
  if (!client.dryRun) pipelineIdCache = match.id;
  return match.id;
}

export async function searchDeals(query: string, client: HubSpotClient = createHubSpotClient()): Promise<DealHit[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const pipeline = await pipelineId(client);
  const data = await client.request<{ results?: { id: string; properties: Record<string, string | null> }[] }>(
    '/crm/v3/objects/deals/search',
    {
      method: 'POST',
      body: {
        query: q,
        filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: pipeline }] }],
        properties: ['dealname', 'amount', 'dealstage'],
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        limit: 10,
      },
    },
  );
  const hits = (data.results || []).map((r) => ({
    id: String(r.id),
    name: r.properties.dealname || `Deal ${r.id}`,
    amount: r.properties.amount ? Number(r.properties.amount) : null,
    stage: r.properties.dealstage || null,
  }));
  // The dry-run stub returns a fixed list; narrow it so the picker still behaves.
  return client.dryRun ? hits.filter((h) => h.name.toLowerCase().includes(q.toLowerCase())) : hits;
}
