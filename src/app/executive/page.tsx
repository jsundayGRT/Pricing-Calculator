import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { ExecutiveSummaryClient } from '@/components/ExecutiveSummaryClient';
import { isAdmin } from '@/lib/admin';
import { readSession } from '@/lib/session';

export default async function ExecutivePage() {
  const user = await readSession();
  if (!user) redirect('/login');
  if (!isAdmin(user)) redirect('/');

  return (
    <>
      <AppHeader user={user} active="executive" />
      <ExecutiveSummaryClient />
    </>
  );
}
