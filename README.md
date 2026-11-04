# Guardrail Pricing Calculator

Static pricing calculator protected by **Microsoft Entra ID** (OAuth 2.0 / OpenID Connect) on Vercel.

## Auth overview

| Route | Purpose |
| --- | --- |
| `/login` | Sign-in screen with **Sign in with Microsoft** |
| `/api/auth/login` | Starts Entra authorization code + PKCE flow |
| `/api/auth/callback` | Exchanges code, creates HTTP-only session cookie |
| `/api/auth/me` | Returns the signed-in user |
| `/api/auth/logout` | Clears the session and ends the Entra session |

Unauthenticated visits to `/` are redirected to `/login` by Vercel Edge Middleware.

Secrets stay server-side in environment variables. The browser only receives an opaque signed session cookie.

## Entra ID app registration

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**
2. Supported account types: **Accounts in this organizational directory only** (single tenant)
3. Platform: **Web**
4. Redirect URIs:
   - Production: `https://YOUR_VERCEL_DOMAIN/api/auth/callback`
   - Local: `http://localhost:3000/api/auth/callback`
5. Certificates & secrets → create a **Client secret**
6. Copy **Application (client) ID**, **Directory (tenant) ID**, and the secret value

Optional: set `AZURE_AD_ALLOWED_EMAIL_DOMAIN` (for example `guardrail.ai`) to reject other domains even inside the tenant.

## Environment variables

Copy `.env.example` to `.env.local` for local use, and set the same values in the Vercel project:

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_AD_TENANT_ID` | Yes | Directory (tenant) ID |
| `AZURE_AD_CLIENT_ID` | Yes | Application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Yes | Client secret value |
| `SESSION_SECRET` | Yes | Long random string used to sign cookies (`openssl rand -base64 48`) |
| `AZURE_AD_ALLOWED_EMAIL_DOMAIN` | No | Restrict sign-in to one email domain |
| `APP_BASE_URL` | No | Public origin if proxy headers are unavailable |

## Local preview

```bash
npm install
npx vercel env pull .env.local   # or copy .env.example → .env.local
npx vercel dev
```

Open `http://localhost:3000`. You should land on `/login`, then the calculator after Microsoft sign-in.

## Deploy

Push to `main` with the GitHub repo connected to Vercel, then add the environment variables in the Vercel project settings and redeploy.
