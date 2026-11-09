/* eslint-disable @next/next/no-html-link-for-pages */
import { isAdmin } from '@/lib/admin';
import type { SessionUser } from '@/lib/session';
import { UserMenu } from '@/components/UserMenu';
import { ThemeToggle } from '@/components/theme';

export async function AppHeader({
  user,
  active,
}: {
  user?: SessionUser | null;
  active?: 'dashboard' | 'calculator' | 'executive';
}) {
  const admin = await isAdmin(user);

  return (
    <header className={user ? 'topbar' : 'topbar signed-out'}>
      <div className="topbar-inner">
        <div className="topbar-row">
          <div>
            <div className="brand">
              <span className="shield">
                {/* eslint-disable @next/next/no-img-element */}
                <img className="logo-dark" src="/shield-white.png" alt="Guardrail" />
                <img className="logo-light" src="/shield.png" alt="Guardrail" />
                {/* eslint-enable @next/next/no-img-element */}
              </span>
              <h1 className="brand-title">Guardrail Pricing Calculator</h1>
            </div>
          </div>
          {user ? (
            <div className="chips">
              <ThemeToggle />
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
