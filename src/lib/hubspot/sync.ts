// Pushes a locked (or approved) pricing request to HubSpot: line items, a quote on the deal
// (linking the customer quote PDF), the deal amount, and the PDF as a note. Safe to run again: a request that
// already has a quote updates it instead of creating another.

import { getQuoteById, readQuotePdf, updateQuoteHubSpot, type HubSpotSync, type QuoteRecord } from '../quotes';
import { createHubSpotClient, hubspotEnabled, type HubSpotClient } from './client';
import { buildQuotePricing, lineItemProperties } from './payload';

// HubSpot-defined association type IDs (CRM v4).
const ASSOC = {
  lineItemToDeal: 20,
  quoteToDeal: 64,
  quoteToLineItem: 67,
  quoteToContact: 69,
  quoteToCompany: 71,
  quoteToTemplate: 286,
  noteToDeal: 214,
  dealToPrimaryCompany: 5,
};

export const PRICING_REQUEST_PROPERTY = 'pricing_request_id';
const FILES_FOLDER = 'Pricing Calculator';

type Assoc = { to: { id: string }; types: { associationCategory: 'HUBSPOT_DEFINED'; associationTypeId: number }[] };
const assoc = (id: string, typeId: number): Assoc => ({
  to: { id },
  types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }],
});

export type SyncResult = { ok: boolean; hubspot: HubSpotSync | null };

export async function syncRequestToHubSpot(
  recordId: string,
  opts: { client?: HubSpotClient; now?: Date } = {},
): Promise<SyncResult> {
  const record = await getQuoteById(recordId);
  if (!record) return { ok: false, hubspot: null };
  const dealId = record.hubspot?.dealId;
  if (!dealId) return { ok: false, hubspot: record.hubspot ?? null };
  // A Deal Review goes to HubSpot only once approved; a declined one never does.
  if (record.status === 'DEAL REVIEW' || record.status === 'NOT APPROVED') {
    if (record.hubspot?.status === 'synced') return { ok: false, hubspot: record.hubspot };
    const hs = (await updateQuoteHubSpot(recordId, { status: 'awaiting-approval', error: null }))?.hubspot;
    return { ok: false, hubspot: hs ?? null };
  }
  if (!opts.client && !hubspotEnabled()) {
    const hs = (await updateQuoteHubSpot(recordId, { status: 'skipped', error: 'HubSpot is not configured (HUBSPOT_TOKEN is not set).' }))?.hubspot;
    return { ok: false, hubspot: hs ?? null };
  }

  const client = opts.client ?? createHubSpotClient();
  const now = opts.now ?? new Date();
  const attempts = (record.hubspot?.attempts ?? 0) + 1;
  await updateQuoteHubSpot(recordId, { attempts, lastAttemptAt: now.toISOString() });

  try {
    const done = await pushToHubSpot(client, record, dealId, now);
    const hs = (await updateQuoteHubSpot(recordId, { ...done, status: 'synced', error: null, syncedAt: now.toISOString() }))?.hubspot;
    return { ok: true, hubspot: hs ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hubspot] sync failed for ${record.requestId} v${record.version} (${record.id}):`, err);
    const hs = (await updateQuoteHubSpot(recordId, { status: 'failed', error: message.slice(0, 500) }))?.hubspot;
    return { ok: false, hubspot: hs ?? null };
  }
}

async function pushToHubSpot(client: HubSpotClient, record: QuoteRecord, dealId: string, now: Date) {
  const { request } = client;
  const prev = record.hubspot || ({} as HubSpotSync);
  const requestLabel = `${record.requestId} v${record.version}`;
  const pricing = buildQuotePricing(record.snapshot);

  const deal = await request<{ properties?: Record<string, string> }>(
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealname`,
  );
  const dealName = deal.properties?.dealname || prev.dealName || record.customerName;
  const { contactId, companyId } = await primaryParties(client, dealId);
  const account = await getAccount(client);

  // 1. Line items. On a re-sync the old ones are replaced so the quote matches this version.
  for (const id of prev.lineItemIds || []) {
    await request(`/crm/v3/objects/line_items/${encodeURIComponent(id)}`, { method: 'DELETE', allow404: true });
  }
  const lineItemIds: string[] = [];
  for (const li of pricing.lineItems) {
    const created = await request<{ id: string }>('/crm/v3/objects/line_items', {
      method: 'POST',
      body: {
        properties: lineItemProperties(li, pricing.currency, pricing.termMonths),
        associations: [assoc(dealId, ASSOC.lineItemToDeal)],
      },
    });
    lineItemIds.push(String(created.id));
  }

  // 2. The customer quote PDF, uploaded once (private: only signed-in HubSpot users can open it).
  // Saved right away so a failure later in the sync doesn't upload it again on retry.
  let fileId = prev.fileId || null;
  if (!fileId) {
    const pdf = await readQuotePdf(record.id);
    if (!pdf) throw new Error('No quote PDF was saved with this request. Lock it again from the calculator.');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(pdf)],{ type: 'application/pdf' }), pdfFileName(record));
    form.append('folderPath', FILES_FOLDER);
    form.append('options', JSON.stringify({ access: 'PRIVATE', overwrite: false, duplicateValidationStrategy: 'NONE' }));
    const uploaded = await request<{ id: string }>('/files/v3/files', { method: 'POST', form });
    fileId = String(uploaded.id);
    await updateQuoteHubSpot(record.id, { fileId });
  }
  const pdfUrl = `https://${account.uiDomain}/files/${account.portalId}/?showDetails=${fileId}`;

  // 3. The quote. Quotes can't hold attachments, so the PDF is linked from its comments.
  // Dates are the HubSpot account's calendar dates (its time zone), not UTC.
  const expiry = new Date(now.getTime() + expiryDays() * 86_400_000);
  const quoteProps: Record<string, string> = {
    hs_title: `${dealName} – Pricing – ${requestLabel}`,
    hs_status: 'DRAFT',
    hs_expiration_date: localDate(expiry, account.timeZone),
    hs_currency: pricing.currency,
    hs_language: 'en',
    hs_comments: `Pricing calculator PDF (${requestLabel}, Guardrail team only): ${pdfUrl}`,
  };
  const templateId = process.env.HUBSPOT_QUOTE_TEMPLATE_ID || '';
  let quoteId = prev.quoteId || null;
  if (quoteId) {
    // Leave hs_status alone: someone may have published the quote in HubSpot since.
    const { hs_status: _status, ...updateProps } = quoteProps;
    void _status;
    await request(`/crm/v3/objects/quotes/${encodeURIComponent(quoteId)}`, { method: 'PATCH', body: { properties: updateProps } });
    for (const id of lineItemIds) {
      await request(`/crm/v4/objects/quotes/${quoteId}/associations/default/line_items/${id}`, { method: 'PUT' });
    }
  } else {
    if (!templateId) throw new Error('HUBSPOT_QUOTE_TEMPLATE_ID is not set');
    const associations = [
      assoc(dealId, ASSOC.quoteToDeal),
      assoc(templateId, ASSOC.quoteToTemplate),
      ...lineItemIds.map((id) => assoc(id, ASSOC.quoteToLineItem)),
      ...(contactId ? [assoc(contactId, ASSOC.quoteToContact)] : []),
      ...(companyId ? [assoc(companyId, ASSOC.quoteToCompany)] : []),
    ];
    const created = await request<{ id: string }>('/crm/v3/objects/quotes', {
      method: 'POST',
      body: { properties: quoteProps, associations },
    });
    quoteId = String(created.id);
  }
  // HubSpot opens quotes at /contacts/<portal>/quote/<id> (the generic /record/0-14/ page is "not found").
  const quoteUrl = `https://${account.uiDomain}/contacts/${account.portalId}/quote/${quoteId}`;

  // 4. The deal: amount follows the quote, and it records which request priced it.
  await ensureDealProperty(client);
  await request(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    method: 'PATCH',
    body: { properties: { amount: pricing.total.toFixed(2), [PRICING_REQUEST_PROPERTY]: requestLabel } },
  });

  // 5. The same PDF attached to a note on the deal.
  const noteProps = {
    hs_timestamp: now.toISOString(),
    hs_note_body: noteBody(record, requestLabel, quoteUrl, account.timeZone),
    hs_attachment_ids: fileId,
  };
  let noteId = prev.noteId || null;
  if (noteId) {
    await request(`/crm/v3/objects/notes/${encodeURIComponent(noteId)}`, { method: 'PATCH', body: { properties: noteProps } });
  } else {
    const note = await request<{ id: string }>('/crm/v3/objects/notes', {
      method: 'POST',
      body: { properties: noteProps, associations: [assoc(dealId, ASSOC.noteToDeal)] },
    });
    noteId = String(note.id);
  }

  return { dealName, quoteId, quoteUrl, fileId, noteId, lineItemIds };
}

function expiryDays() {
  const n = Number(process.env.HUBSPOT_QUOTE_EXPIRY_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

function pdfFileName(record: QuoteRecord) {
  const name = record.customerName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  return `Guardrail Quote - ${name} - ${record.requestId}-v${record.version}.pdf`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function localDate(d: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10); // unknown time zone
  }
}

function noteBody(record: QuoteRecord, requestLabel: string, quoteUrl: string, timeZone: string) {
  const by = record.ownerName || record.ownerEmail;
  const lockedAt = new Date(record.lockedAt);
  const lockedOn = Number.isNaN(lockedAt.getTime()) ? String(record.lockedAt).slice(0, 10) : localDate(lockedAt, timeZone);
  const approval = record.snapshot.approval as { by?: string; at?: string } | undefined;
  const approved = approval?.by ? ` Approved by ${escapeHtml(approval.by)} on ${escapeHtml(String(approval.at || ''))}.` : '';
  return `Pricing request ${escapeHtml(requestLabel)} locked by ${escapeHtml(by)} on ${lockedOn}.${approved} `
    + `Quote: <a href="${quoteUrl}">${quoteUrl}</a>`;
}

type Account = { portalId: string; uiDomain: string; timeZone: string };
let accountCache: Account | null = null;
// Portal ID, app domain (e.g. app-na2.hubspot.com) and time zone, for links and dates.
async function getAccount(client: HubSpotClient): Promise<Account> {
  if (accountCache && !client.dryRun) return accountCache;
  const info = await client.request<{ portalId?: number; uiDomain?: string; timeZone?: string }>('/account-info/v3/details');
  const account = {
    portalId: process.env.HUBSPOT_PORTAL_ID || String(info.portalId ?? ''),
    uiDomain: info.uiDomain || 'app.hubspot.com',
    timeZone: info.timeZone || 'UTC',
  };
  if (!client.dryRun) accountCache = account;
  return account;
}

type AssocList = { results?: { toObjectId: number | string; associationTypes?: { typeId: number }[] }[] };

// The deal's primary company (HubSpot's "Primary" label) and its first contact.
async function primaryParties(client: HubSpotClient, dealId: string) {
  const [companies, contacts] = await Promise.all([
    client.request<AssocList>(`/crm/v4/objects/deals/${dealId}/associations/companies?limit=100`),
    client.request<AssocList>(`/crm/v4/objects/deals/${dealId}/associations/contacts?limit=100`),
  ]);
  const co = companies?.results || [];
  const primary = co.find((r) => r.associationTypes?.some((t) => t.typeId === ASSOC.dealToPrimaryCompany)) || co[0];
  const contact = (contacts?.results || [])[0];
  return {
    companyId: primary ? String(primary.toObjectId) : null,
    contactId: contact ? String(contact.toObjectId) : null,
  };
}

let propertyChecked = false;
async function ensureDealProperty(client: HubSpotClient) {
  if (propertyChecked && !client.dryRun) return;
  const existing = await client.request(`/crm/v3/properties/deals/${PRICING_REQUEST_PROPERTY}`, { allow404: true });
  if (!existing) {
    await client.request('/crm/v3/properties/deals', {
      method: 'POST',
      body: {
        name: PRICING_REQUEST_PROPERTY,
        label: 'Pricing request ID',
        type: 'string',
        fieldType: 'text',
        groupName: 'dealinformation',
        description: 'The Guardrail Pricing Calculator request (and version) that priced this deal.',
      },
    });
  }
  if (!client.dryRun) propertyChecked = true;
}

// For tests: forget what was cached between runs.
export function resetHubSpotCaches() {
  accountCache = null;
  propertyChecked = false;
}
