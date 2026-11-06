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
      <div className="topbar-inner">
        <div className="topbar-row">
          <div>
            <div className="brand">
              <span className="shield">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="Guardrail" />
              </span>
              <h1 className="brand-title">Guardrail Pricing Calculator</h1>
            </div>
          </div>
          {user ? (
            <div className="chips">
              <span className="info-chip">Role <b>{admin ? 'Admin' : 'Rep'}</b></span>
              <UserMenu name={user.name} email={user.email} admin={admin} />
            </div>
          ) : null}
        </div>
        {user ? (
          <nav className="nav">
            <a href="/" className={active === 'dashboard' ? 'active' : undefined}>Dashboard</a>
            <a href="/calculator" className={active === 'calculator' ? 'active' : undefined}>Calculator</a>
            {admin ? (
              <a href="/executive" className={active === 'executive' ? 'active' : undefined}>
                Executive Dashboard
              </a>
            ) : null}
          </nav>
        ) : (
          <div style={{ height: 22 }} />
        )}
      </div>
    </header>
  );
}
