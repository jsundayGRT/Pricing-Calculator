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

`jared.sunday@guardrail.tech`, `susan.landaluce@guardrail.tech`, and `dena.lumbang@guardrail.tech` are admins by default. Add more with `ADMIN_EMAILS`.

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

When a rep locks a pricing request, the server sends it to the HubSpot deal the rep picked. A request that needs a **Deal Review** waits: it is sent only once it is approved (on the Executive Dashboard or in Slack), and a declined one is never sent. What is sent:

1. One line item per priced product (customer-facing prices only: list price, discount, annual billing over the contract term; implementation is one-time). Cost, margin and every other executive-only figure stay in the app.
2. A **Draft** quote titled `<Deal name> – Pricing – <request ID> v<version>`, expiring in `HUBSPOT_QUOTE_EXPIRY_DAYS`, using the `HUBSPOT_QUOTE_TEMPLATE_ID` template, and associated with the deal, its line items, the deal's primary company and its first contact.
3. The deal's **Amount** is set to the quote total (Year 1, after all discounts), and its **Pricing request ID** property is set (the property is created on first use).
4. The customer quote PDF from the calculator is uploaded to the private **Pricing Calculator** folder in HubSpot Files. HubSpot quotes can't hold attachments, so the quote's **Comments to buyer** links to the PDF (the link opens only for signed-in HubSpot users), and the PDF is also attached to a note on the deal: *Pricing request … locked by … on …. Quote: …*

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

## Slack Deal Review approvals

When a locked request needs a **Deal Review**, the app posts it to a Slack channel with **Approve** and **Decline** buttons. Anyone in the channel can decide; the click works exactly like approving or declining on the Executive Dashboard (an approval also updates the HubSpot quote), and the message is updated to show who decided. A decision made on the Executive Dashboard updates the Slack message too, so nobody acts on it twice. If Slack is down or not configured, locking works as before.

The message shows the customer, request ID, rep, Year 1 price, requested and applied discount, margin against target, term, customer size, HubSpot deal and the reason for review, plus a link to the Executive Dashboard. Keep the channel to people who may see margins.

### Set it up

1. Requires Redis storage (see **Storage** below), so the request still exists when someone clicks.
2. At https://api.slack.com/apps → **Create New App** → **From a manifest**, pick the workspace and paste [`slack-app-manifest.yml`](slack-app-manifest.yml) (change the URL in it if the app runs elsewhere). Install it to the workspace.
3. Create the channel (for example `#deal-review`) and invite the app: `/invite @Guardrail Pricing`.
4. In Vercel add:

| Variable | Value |
|---|---|
| `SLACK_BOT_TOKEN` | **OAuth & Permissions → Bot User OAuth Token** (`xoxb-…`). Secret. |
| `SLACK_SIGNING_SECRET` | **Basic Information → Signing Secret**. Secret. |
| `SLACK_DEAL_REVIEW_CHANNEL` | The channel ID (channel name → **View channel details** → bottom, e.g. `C0123ABCD`). |

Then redeploy.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Entra + SESSION_SECRET
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Push to `main` with the GitHub repo connected to Vercel. Set the env vars in the Vercel project and redeploy.

### Storage

Locked requests and their quote PDFs are kept in **Upstash Redis** when it is connected: in Vercel open the project → **Storage** → **Create Database** → **Upstash for Redis** (free plan) and connect it to the project, which adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`; then redeploy. Without those variables the app falls back to a JSON file (`data/quotes.json` locally, `/tmp` on Vercel), which is fine for local development but not on Vercel: `/tmp` is per-instance and temporary, so requests can disappear, and Slack approvals would often find nothing.
