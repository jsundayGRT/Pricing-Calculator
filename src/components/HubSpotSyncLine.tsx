import type { HubSpotSync } from '@/lib/quotes';

export function hubspotLabel(hs?: HubSpotSync | null, requestStatus?: string) {
  if (!hs?.dealId) return null;
  if (hs.status === 'synced') return 'HubSpot quote synced';
  if (requestStatus === 'NOT APPROVED') return 'Not sent to HubSpot (not approved)';
  if (hs.status === 'awaiting-approval' || requestStatus === 'DEAL REVIEW') return 'Goes to HubSpot once approved';
  if (hs.status === 'failed') return 'HubSpot sync failed';
  if (hs.status === 'skipped') return 'HubSpot not connected';
  return 'HubSpot sync pending';
}

// Requests synced before the link fix saved /record/0-14/<id>, which HubSpot doesn't serve.
export function quoteLink(hs?: HubSpotSync | null) {
  return hs?.quoteUrl ? hs.quoteUrl.replace('/record/0-14/', '/quote/') : null;
}

export function HubSpotSyncLine({ hubspot, status }: { hubspot?: HubSpotSync | null; status?: string }) {
  const label = hubspotLabel(hubspot, status);
  if (!label || !hubspot) return null;
  return (
    <div>
      <span style={{ color: hubspot.status === 'failed' ? 'var(--bad)' : undefined }}>{label}</span>
      {quoteLink(hubspot) ? (
        <>
          {' · '}
          <a href={quoteLink(hubspot)!} target="_blank" rel="noopener noreferrer">Open quote</a>
        </>
      ) : null}
    </div>
  );
}
