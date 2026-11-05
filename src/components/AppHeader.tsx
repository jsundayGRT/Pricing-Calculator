/* eslint-disable @next/next/no-html-link-for-pages */
import { isAdmin } from '@/lib/admin';
import type { SessionUser } from '@/lib/session';
import { UserMenu } from '@/components/UserMenu';

export function AppHeader({
  user,
  active,
}: {
  user?: SessionUser | null;
  active?: 'dashboard' | 'calculator' | 'executive';
}) {
  const admin = isAdmin(user);

  return (
    <header className="topbar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Guardrail Technologies" width={157} height={46} />
        <span className="brand-sep" aria-hidden="true" />
        <span className="brand-app">Pricing</span>
      </div>
      {user ? (
        <>
          <nav className="nav">
            <a href="/" className={active === 'dashboard' ? 'active' : undefined}>Dashboard</a>
            <a href="/calculator" className={active === 'calculator' ? 'active' : undefined}>Calculator</a>
            {admin ? (
              <a href="/executive" className={active === 'executive' ? 'active' : undefined}>
                Executive Dashboard
              </a>
            ) : null}
          </nav>
          <UserMenu name={user.name} email={user.email} admin={admin} />
        </>
      ) : null}
    </header>
  );
}
