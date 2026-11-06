import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await readSession();
  if (user && !((await searchParams).error)) redirect('/');
  const params = await searchParams;
  const error = params.error || '';

  // One card, centred on the page: logo and title, then the sign-in action. No header bar.
  return (
    <main className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <span className="shield login-shield">
            {/* eslint-disable @next/next/no-img-element */}
            <img className="logo-dark" src="/shield-white.png" alt="Guardrail" />
            <img className="logo-light" src="/shield.png" alt="Guardrail" />
            {/* eslint-enable @next/next/no-img-element */}
          </span>
          <h1 className="brand-title login-name">Guardrail Pricing Calculator</h1>
        </div>
        <div className="login-divider" />
        <h2 className="login-title">Sign in</h2>
        <div className="err" role="alert">{error}</div>
        <a className="btn primary login-btn" href="/api/auth/login">
          <svg className="ms-icon" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </a>
        <div className="fine">Secured with Microsoft Entra ID</div>
      </div>
    </main>
  );
}
