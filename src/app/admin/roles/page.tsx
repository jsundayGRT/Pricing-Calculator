import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { RolesClient } from '@/components/RolesClient';
import { isAdmin } from '@/lib/admin';
import { readSession } from '@/lib/session';

export default async function RolesPage() {
  const user = await readSession();
  if (!user) redirect('/login');
  if (!(await isAdmin(user))) {
    return (
      <>
        <AppHeader user={user} />
        <main className="page">
          <h1>Manage roles</h1>
          <p className="sub">Signed in as {user.email || user.name}. Only admins can manage roles.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader user={user} />
      <RolesClient myEmail={user.email} />
    </>
  );
}
