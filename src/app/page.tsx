import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { DashboardClient } from '@/components/DashboardClient';
import { readSession } from '@/lib/session';

export default async function HomePage() {
  const user = await readSession();
  if (!user) redirect('/login');

  return (
    <>
      <AppHeader user={user} active="dashboard" />
      <DashboardClient userName={user.name || user.email} />
    </>
  );
}
