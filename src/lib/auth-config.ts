export type AuthConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  allowedEmailDomain: string | null;
  authority: string;
  authorizeUrl: string;
  tokenUrl: string;
  logoutUrl: string;
  scopes: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getAuthConfig(): AuthConfig {
  const tenantId = required('AZURE_AD_TENANT_ID');
  const clientId = required('AZURE_AD_CLIENT_ID');
  const clientSecret = required('AZURE_AD_CLIENT_SECRET');
  const sessionSecret = required('SESSION_SECRET');
  const allowedEmailDomain = (process.env.AZURE_AD_ALLOWED_EMAIL_DOMAIN || '').trim().toLowerCase() || null;
  const authority = `https://login.microsoftonline.com/${tenantId}`;

  return {
    tenantId,
    clientId,
    clientSecret,
    sessionSecret,
    allowedEmailDomain,
    authority,
    authorizeUrl: `${authority}/oauth2/v2.0/authorize`,
    tokenUrl: `${authority}/oauth2/v2.0/token`,
    logoutUrl: `${authority}/oauth2/v2.0/logout`,
    scopes: 'openid profile email offline_access',
  };
}

export function getBaseUrl(request: Request) {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protoHeader = request.headers.get('x-forwarded-proto');
  const proto = protoHeader?.split(',')[0]?.trim()
    || (host?.includes('localhost') ? 'http' : 'https');
  if (!host) throw new Error('Unable to determine request host for redirect URI');
  return `${proto}://${host}`;
}

export function getRedirectUri(request: Request) {
  return `${getBaseUrl(request)}/api/auth/callback`;
}
