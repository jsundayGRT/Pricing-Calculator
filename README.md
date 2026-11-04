# Guardrail Pricing Calculator

React (Next.js) app with **Microsoft Entra ID** sign-in and a **per-user dashboard** for locked quotes.

## What you get

| Route | Purpose |
| --- | --- |
| `/login` | Sign in with Microsoft |
| `/` | Personal dashboard (only your locked quotes) |
| `/calculator` | Pricing calculator |
| `/executive` | Admin-only Executive summary (all locked requests + internal economics) |
| `/api/quotes` | Save / list quotes for the signed-in user |
| `/api/admin/quotes` | Admin list/detail of every locked request |

`jared.sunday@guardrail.tech` is an admin by default. Add more with `ADMIN_EMAILS`.

After you lock a pricing request in the calculator, it is saved to **your** dashboard (not shared with other users).

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `AZURE_AD_TENANT_ID` | Yes | Directory (tenant) ID |
| `AZURE_AD_CLIENT_ID` | Yes | Application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Yes | Client secret value |
| `SESSION_SECRET` | Yes | Long random string (`openssl rand -base64 48`) |
| `AZURE_AD_ALLOWED_EMAIL_DOMAIN` | No | Restrict to one email domain |
| `APP_BASE_URL` | No | Public origin override |

Entra redirect URI:

`https://YOUR_DOMAIN/api/auth/callback`

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Entra + SESSION_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Push to `main` with the GitHub repo connected to Vercel. Set the env vars in the Vercel project and redeploy.

### Quote storage note

Quotes are stored in a JSON file (`data/quotes.json` locally, `/tmp/grt-quotes.json` on Vercel). That is fine for an internal MVP; for durable multi-instance production later, swap the store in `src/lib/quotes.ts` for Postgres/Redis.
