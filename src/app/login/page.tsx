import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
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

  return (
    <>
      <AppHeader />
      <div className="login-shell">
        <div className="login-panel">
          <div className="hero">
            <small>Guardrail Technologies</small>
            <div className="amount" style={{ fontSize: 28 }}>Pricing calculator</div>
          </div>
          <div className="card">
            <div className="err" role="alert">{error}</div>
            <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
              Sign in with your Guardrail Microsoft account to open your personal dashboard and pricing calculator.
            </p>
            <a className="btn primary" href="/api/auth/login" style={{ width: '100%' }}>
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
        </div>
      </div>
    </>
  );
}
