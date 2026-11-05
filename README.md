# Guardrail Pricing Calculator

React (Next.js) app with **Microsoft Entra ID** sign-in and a **per-user dashboard** for locked quotes.

## What you get

| Route | Purpose |
| --- | --- |
| `/login` | Sign in with Microsoft |
| `/` | Personal dashboard (only your locked quotes) |
| `/calculator` | Pricing calculator |
| `/executive` | Admin-only Executive Dashboard (all locked requests, approvals, and internal economics) |
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

## HubSpot integration

When a rep locks a pricing request, or an executive approves one, the server sends it to the HubSpot deal the rep picked:

1. One line item per priced product (customer-facing prices only: list price, discount, annual billing over the contract term; implementation is one-time). Cost, margin and every other executive-only figure stay in the app.
2. A **Draft** quote titled `<Deal name> – Pricing – <request ID> v<version>`, expiring in `HUBSPOT_QUOTE_EXPIRY_DAYS`, using the `HUBSPOT_QUOTE_TEMPLATE_ID` template, and associated with the deal, its line items, the deal's primary company and its first contact.
3. The deal's **Amount** is set to the quote total (Year 1, after all discounts), and its **Pricing request ID** property is set (the property is created on first use).
4. The customer quote PDF from the calculator is uploaded to the private **Pricing Calculator** folder in HubSpot Files and attached to a note on the deal: *Pricing request … locked by … on …. Quote: …*

Each locked version gets its own HubSpot quote. Syncing a version again (a retry, or an approval after the lock) updates that quote instead of creating a second one, replaces its line items, and keeps a quote someone already published in its published state. Pilot fees are not added to the quote.

The sync runs after the lock is saved. If HubSpot fails, the lock still stands and the request shows **HubSpot sync failed**. HubSpot rate limits (429) are retried with backoff.

The pricing request form has a required **HubSpot deal** search box limited to the Guardrail Sales Pipeline. If HubSpot isn't configured, the box says so and requests lock without a deal.

### Create the private app

1. In HubSpot go to **Settings → Integrations → Private Apps → Create a private app**, name it *Guardrail Pricing Calculator*.
2. On **Scopes**, add:
   - `crm.objects.deals.read`, `crm.objects.deals.write`
   - `crm.objects.line_items.write`
   - `crm.objects.quotes.write`
   - `crm.objects.contacts.read`, `crm.objects.companies.read`
   - `files`
   - `crm.objects.notes.write` (in some portals this is covered by the contacts or deals write scope)
   - `crm.schemas.deals.write` — only needed once, so the app can create the **Pricing request ID** deal property. Without it, create a single-line text deal property with internal name `pricing_request_id` yourself.
3. Create the app and copy its access token into `HUBSPOT_TOKEN`. The token stays on the server; the browser only ever talks to this app's own API.
4. Find the quote template ID: **Settings → Objects → Quotes → Templates**, open the template and copy the number in its URL into `HUBSPOT_QUOTE_TEMPLATE_ID`.
5. Quotes in a currency other than USD (AUS, LATAM) need that currency turned on in **Settings → Account defaults → Currencies**.

### HubSpot environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `HUBSPOT_TOKEN` | For the integration | Private app access token. Server only. |
| `HUBSPOT_QUOTE_TEMPLATE_ID` | For the integration | Quote template used for new quotes |
| `HUBSPOT_QUOTE_EXPIRY_DAYS` | No | Days until a quote expires (default `30`) |
| `HUBSPOT_PIPELINE_ID` | No | Deal pipeline to search. Default: the pipeline labelled *Guardrail Sales Pipeline* |
| `HUBSPOT_PORTAL_ID` | No | HubSpot account ID for quote links. Looked up from the token when unset |
| `HUBSPOT_DRY_RUN` | No | `1` logs every HubSpot payload to the server log and calls nothing (fake deals and IDs) |
| `DATA_DIR` | No | Folder for the request store and saved quote PDFs |

### Retry a failed sync

Open the request on the **Executive Dashboard** (admins only). The **HubSpot** card shows the status, the error, and a link to the quote once it exists. Press **Retry sync**: it updates the existing quote rather than creating another. The server log has the full error (`[hubspot] sync failed for …`).

A retry re-uses the quote PDF saved at lock time. Requests locked before this integration have no saved PDF; lock a new version from the calculator instead.

### Tests

```bash
npm run test:unit   # HubSpot sync against a mocked HubSpot API; no browser or app needed
```

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

Quotes are stored in a JSON file (`data/quotes.json` locally, `/tmp/grt-quotes.json` on Vercel), and the quote PDFs saved for HubSpot next to it (`quote-pdfs/`). On Vercel `/tmp` does not survive a redeploy or a new instance, so HubSpot sync status and the saved PDF can be lost with it. That is fine for an internal MVP; for durable multi-instance production later, swap the store in `src/lib/quotes.ts` for Postgres/Redis.
