import type { HubSpotSync } from '@/lib/quotes';

export function hubspotLabel(hs?: HubSpotSync | null) {
  if (!hs?.dealId) return null;
  if (hs.status === 'synced') return 'HubSpot quote synced';
  if (hs.status === 'failed') return 'HubSpot sync failed';
  if (hs.status === 'skipped') return 'HubSpot not connected';
  return 'HubSpot sync pending';
}

export function HubSpotSyncLine({ hubspot }: { hubspot?: HubSpotSync | null }) {
  const label = hubspotLabel(hubspot);
  if (!label || !hubspot) return null;
  return (
    <div>
      <span style={{ color: hubspot.status === 'failed' ? 'var(--bad)' : undefined }}>{label}</span>
      {hubspot.quoteUrl ? (
        <>
          {' · '}
          <a href={hubspot.quoteUrl} target="_blank" rel="noopener noreferrer">Open quote</a>
        </>
      ) : null}
    </div>
  );
}
