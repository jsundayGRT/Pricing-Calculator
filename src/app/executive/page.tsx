import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { ExecutiveSummaryClient } from '@/components/ExecutiveSummaryClient';
import { isAdmin } from '@/lib/admin';
import { readSession } from '@/lib/session';

export default async function ExecutivePage() {
  const user = await readSession();
  if (!user) redirect('/login');
  if (!(await isAdmin(user))) {
    return (
      <>
        <AppHeader user={user} />
        <main className="page">
          <h1>Executive Dashboard</h1>
          <p className="sub">
            Signed in as {user.email || user.name}. This account does not have admin access.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader user={user} active="executive" />
      <ExecutiveSummaryClient />
    </>
  );
}
