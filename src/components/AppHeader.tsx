import Link from 'next/link';
import { isAdmin } from '@/lib/admin';
import type { SessionUser } from '@/lib/session';

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
        <img src="/logo.png" alt="Guardrail Technologies" width={135} height={40} />
        <span className="brand-sep" aria-hidden="true" />
        <span className="brand-app">Pricing</span>
      </div>
      {user ? (
        <>
          <nav className="nav">
            <Link href="/" className={active === 'dashboard' ? 'active' : undefined}>Dashboard</Link>
            <Link href="/calculator" className={active === 'calculator' ? 'active' : undefined}>Calculator</Link>
            {admin ? (
              <Link href="/executive" className={active === 'executive' ? 'active' : undefined}>
                Executive summary
              </Link>
            ) : null}
          </nav>
          <div className="who">
            <span>
              {user.name}{user.email ? ` · ${user.email}` : ''}
              {admin ? ' · Admin' : ''}
            </span>
            <Link className="btn small" href="/api/auth/logout">Sign out</Link>
          </div>
        </>
      ) : null}
    </header>
  );
}
