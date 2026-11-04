import Link from 'next/link';
import type { SessionUser } from '@/lib/session';

export function AppHeader({
  user,
  active,
}: {
  user?: SessionUser | null;
  active?: 'dashboard' | 'calculator';
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <img src="/logo.png" alt="Guardrail Technologies" width={135} height={40} />
        <span className="brand-sep" aria-hidden="true" />
        <span className="brand-app">Pricing</span>
      </div>
      {user ? (
        <>
          <nav className="nav">
            <Link href="/" className={active === 'dashboard' ? 'active' : undefined}>Dashboard</Link>
            <Link href="/calculator" className={active === 'calculator' ? 'active' : undefined}>Calculator</Link>
          </nav>
          <div className="who">
            <span>{user.name}{user.email ? ` · ${user.email}` : ''}</span>
            <Link className="btn small" href="/api/auth/logout">Sign out</Link>
          </div>
        </>
      ) : null}
    </header>
  );
}
