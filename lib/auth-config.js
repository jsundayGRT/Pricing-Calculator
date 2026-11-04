function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getAuthConfig() {
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

export function getBaseUrl(req) {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader)?.split(',')[0]?.trim()
    || (host?.includes('localhost') ? 'http' : 'https');
  if (!host) throw new Error('Unable to determine request host for redirect URI');
  return `${proto}://${host}`;
}

export function getRedirectUri(req) {
  return `${getBaseUrl(req)}/api/auth/callback`;
}
