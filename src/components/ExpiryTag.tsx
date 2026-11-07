'use client';

import { daysLeft, EXPIRES_SOON_DAYS } from '@/lib/expiry';

// "Valid until Dec 7" while there's time; amber in the last week; red once expired.
export function ExpiryTag({ expiresAt }: { expiresAt?: string | null }) {
  if (!expiresAt) return null;
  const left = daysLeft(expiresAt);
  const date = new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (left < 0) return <span className="expiry expired" title={`Expired ${date}`}>Expired {date}</span>;
  const soon = left <= EXPIRES_SOON_DAYS;
  const text = left === 0 ? 'Expires today' : soon ? `Expires in ${left} day${left === 1 ? '' : 's'}` : `Valid until ${date}`;
  return <span className={`expiry${soon ? ' soon' : ''}`} title={`Valid until ${date}`}>{text}</span>;
}
