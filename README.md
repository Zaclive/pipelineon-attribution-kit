# PipelineOn Open Attribution

Self-hosted website attribution, call/CRM outcome ingestion, a tracking doctor, Meta and Google Ads conversion delivery and read-only assistant tools. MIT licensed. Runs independently with no PipelineOn account, cloud database, paid identity provider or JavaScript package dependencies.

This is an attribution foundation, not full HYROS or AIR parity. It does not identify anonymous people, rent phone numbers, send outreach, train predictive models or dispatch GA4 events. PipelineOn's paid identification, enrichment and follow-up services are separate.

## Canonical events and advertising destinations

Use the [business-event contract](EVENTS.md) to normalize leads, qualified calls/forms, appointments, estimates, won jobs and payments. The same facts feed attribution and independent advertising destinations. Follow [Google Ads setup](GOOGLE-ADS.md) for the Data Manager API adapter. Google validation, submission and completed processing have separate receipts. GA4 is not included.

## Set up your website and CRM

Start with [START-HERE.md](START-HERE.md). It covers both PipelineOn and the self-hosted kit, in the order you need to connect them.

| Guide | Use it for |
| --- | --- |
| [Practical setup recipes](SETUP-RECIPES.md) | Server/free options, Railway, optional Worker proxy, CSV and CRM middleware. |
| [GTM walkthrough](GTM.md) | Consent-aware Custom HTML tag and form handoff checks. |
| [Facebook setup](META-SETUP.md) | Dataset access, private token, sender ownership and Test Events verification. |
| [AI setup instructions](AI-SETUP.md) | A task to give Claude, Codex or another coding assistant, with a private setup brief. |
| [Pixel and event setup](PIXEL-EVENTS.md) | Consent, UTM capture, form/session handoff and real business events. |
| [CRM field mapping and renaming](FIELD-MAPPING.md) | Translate source objects, relationships, statuses, IDs and money into consistent outcomes. |
| [Hosting and optional Cloudflare relay](DEPLOYMENT.md) | Deploy the kit or use PipelineOn; implement middleware only when needed. |
| [End-to-end acceptance checks](ACCEPTANCE.md) | Prove source attribution, revenue, deduplication, recovery and Meta delivery separately. |

Fill the [setup brief](examples/setup-brief.template.json) and [mapping worksheet](examples/crm-mapping.template.json) in your private deployment repository. These are planning worksheets, not executable configuration. The [AI-readable index](llms.txt) links the documentation. Always use docs from the same version as your installed code.

## Connect your data, using the route you choose

Implementation guides: [CRM and middleware setup](INTEGRATIONS.md), [CallRail call matching](CALLRAIL.md), and [CRM API access options](CRM-ACCESS.md). They cover the bundled CallRail connector and both destinations, plus the adapter work needed for other CRMs.

Install the pixel, keep its session reference with the enquiry, and connect your business outcomes to one authenticated API. You can use your backend, a CRM workflow or an automation tool. All routes feed the same attribution engine; a native connector is optional.

```text
Website pixel -> accepted visitorSessionId -> form/call -> CRM or backend
                                                           |
                    your chosen connector / workflow / API |
                                                           v
                                             POST /v1/outcomes
                                                           |
                                             stored facts + attribution
                                                           |
                                             reports + assistant tools
                                                           |
                            explicit meta envelope + consented matching data
                                                           |
                                             durable queue -> Meta -> receipt
```

**Included:** tracking, outcome ingestion, attribution, read-only reports/tools, a CallRail connector, and optional Meta and Google Ads delivery with durable retries and receipts. An accepted import is not a Meta delivery. The outbound leg runs on your server without requiring a PipelineOn account. Verify your own destination in Test Events before enabling live conversions.

Choose the route that fits your setup:

| Route | What you connect |
| --- | --- |
| Your application/backend | Send an authenticated JSON request when a real outcome occurs. |
| CRM workflow or connector | Map the CRM event into the outcome contract and POST it. If the CRM cannot make authenticated HTTP requests, use an adapter. |
| Zapier, Make, n8n or another automation tool | Use a trusted trigger, map the fields and send an authenticated HTTP request. This is a generic HTTP integration, not a bundled native app. |
| Provider webhook | Verify the provider request in your relay, normalize it, then POST to the outcome API. Normalized calls can use `/v1/calls`. |

You supply the connection from your source system to this front door. The kit supplies validation, persistent facts, attribution and explicitly requested Meta delivery. Raw CRM/provider payloads are not accepted without mapping. No generic CRM login or arbitrary-CRM connector is included; the optional CallRail connector is documented separately.

### What your connector must carry

| Data | Map it this way |
| --- | --- |
| `source` + `externalId` | Stable source namespace and unique ID for this activity, not just the customer/deal ID. Keep them unchanged across retries. If an object has several activities, give each activity its own ID. |
| `eventType` + `outcome` | What actually happened, such as `form` / `received` or `payment` / `completed`. A won deal is not automatically a payment. |
| `occurredAt` + `sourceUpdatedAt` | Original activity time and authoritative revision time, both ISO timestamps with timezone. Do not replace them with the automation run time on retries. |
| `visitorSessionId` | Copy the accepted pixel reference into the form/CRM record and carry it through to related outcomes. Omit it or use null if unavailable; never invent a match. |
| `amountMinor` + `currency` | Supply both for a known value, using integer minor units. Keep unknown values absent/null; zero means a known zero. |
| `qualification` | `qualified`, `unqualified` or `unknown`, based on an actual disposition. It is optional and defaults to `unknown`. |

The first three rows are required. The session reference is optional for ingestion but needed for visit attribution in this standalone kit. `contactIds` alone does not link an outcome to a browser. Keep the reference attached to the relevant enquiry or activity; do not overwrite all historical activity with a customer's latest visit. [Pixel setup](#install-the-pixel) explains how to obtain it.

For example, configure your server-side HTTP action as:

```http
POST https://attribution.example.com/v1/outcomes
Authorization: Bearer <KIT_WRITE_TOKEN>
Content-Type: application/json
```

```json
{
  "externalId": "payment-123",
  "source": "my-crm",
  "eventType": "payment",
  "occurredAt": "2026-10-13T12:00:00Z",
  "sourceUpdatedAt": "2026-10-13T12:01:00Z",
  "outcome": "completed",
  "qualification": "qualified",
  "visitorSessionId": "44444444-4444-4444-8444-444444444444",
  "amountMinor": 125050,
  "currency": "USD"
}
```

Replace the sample IDs, times and session with evidence from your own system. Send one outcome per request. Keep the write token in server/automation credentials, never in website JavaScript. Only the documented outcome fields are accepted; do not append raw CRM contact data. The optional `meta` extension below enables advertising delivery.

### Check that your connection is complete

1. Visit a tagged test URL after consent, submit the form and confirm the same accepted session reference is saved against the enquiry in your CRM/backend.
2. Trigger a real test outcome in the source and confirm the request returns HTTP 200 with `status: "created"` (or `"updated"` for a newer correction). This proves ingestion only.
3. Open the report for the outcome's original date. Check its source attribution, linkage and payment amount/currency against the source record. Missing linkage must remain visible, not be assigned a guessed source.
4. Replay the identical request and confirm `status: "duplicate"` with unchanged totals. A late older revision returns `"stale"`; a changed payload at the same revision returns HTTP 409. A 200 response with `"stale"` does not mean your new payload was applied.
5. Configure your connector to retry temporary network/server failures and rate limits with backoff, retaining the same IDs and payload. Inspect validation/authentication/version errors before resending; surface failures to the operator. This inbound retry queue belongs to your connector.
6. For Meta delivery, add the envelope below and configure test mode. Confirm the stored receipt and the same event ID in Events Manager Test Events. Replay the import and check that no new outbound attempt is created.

### Send eligible outcomes to Meta

Delivery is optional. Existing outcomes without `meta` retain their previous behavior. Every connector uses the same envelope; no CRM-specific outbound adapter is required.

1. Use a dataset/pixel you administer and its Conversions API access token. Configure these **on the server** in `.env`:

   ```dotenv
   KIT_META_DATASET_ID=123456789
   KIT_META_ACCESS_TOKEN=your-server-only-token
   KIT_META_MODE=test
   KIT_META_TEST_EVENT_CODE=TEST12345
   ```

2. Get the current test code from Events Manager > your dataset > Test events. Keep that page open during verification. Restart the kit after configuration changes. `disabled` pauses sending. After successful testing, choose `live` and clear the test code. Previously accepted test outcomes are not replayed as live events; use genuine new outcomes.
3. Add the following `meta` object to an outcome (or normalized call). Populate it from your permissioned first-party source. `examples/meta-payment.json` shows a complete synthetic example.

   ```json
   {
     "version": 1,
     "deliveryOwner": "self",
     "consent": "granted",
     "dataProvenance": "customer_provided",
     "deduplication": "shared_event_id",
     "eventId": "invoice-123-purchase",
     "actionSource": "website",
     "eventSourceUrl": "https://example.com/thank-you",
     "userData": {
       "emailSha256": "replace-with-normalized-email-sha256-64-hex-characters",
       "clientUserAgent": "the-actual-converting-browser-user-agent"
     }
   }
   ```

   The illustrative hash above is deliberately invalid; replace it before submitting. Normalize email by trimming and lowercasing before SHA-256. Normalize phone to digits including country code before hashing. Supported matching fields are `emailSha256`, `phoneSha256`, `externalIdSha256`, and observed `fbp`/`fbc`. Hash identifiers, not `fbp`, `fbc` or browser user agent. Never fabricate cookie IDs or forward provider-enriched identities. The kit does not automatically read Meta cookies or scrape contact details. Your consented form/backend integration supplies these fields. A visitor session ID and UTM parameters are not substitutes for Meta matching data.
4. Inspect the dashboard or `GET /v1/meta` with a read token. The worker checks every five seconds and processes up to five events per pass. `POST /v1/meta/flush` with a write token requests an immediate pass. `POST /v1/meta/retry` with `{ "id": "delivery-id" }` can retry a blocked/permanently failed record after its cause is fixed, within the original retry limits. Dashboard access and MCP tools remain read-only.

Supported mappings:

| Actual outcome | Meta event |
| --- | --- |
| Completed payment with amount/currency | `Purchase` |
| Completed booking | `Schedule` |
| Received/completed form | `Lead` |
| Completed call explicitly marked qualified | `Lead` |

The original event must be less than seven days old and not in the future. Website events need the source URL and actual browser user agent. Supported action sources also include `phone_call`, `physical_store`, `chat`, `email`, `system_generated` and `other`; use the actual origin of the conversion. An event imported through a CRM is not necessarily `system_generated`. Money converts from integer currency minor units, including currencies without two decimal places. Unsupported outcomes, missing matching data or incomplete website context receive visible stopped reasons.

### Deduplication, retries and corrections

- Pick **one server sender per logical conversion**. Use `deliveryOwner: "external"` when HubSpot, another connector or another sender owns it. This skips kit delivery. There is no universal API to ask whether an unrelated integration already sent a conversion.
- For browser + server copies, use `shared_event_id` and the same dataset, event name and event ID in both. For example, a browser `fbq('track', 'Purchase', {value: 1250.50, currency: 'USD'}, {eventID: 'invoice-123-purchase'})` must pair with that exact `eventId` here. Coordinate with the existing sender; neither the kit pixel nor this example installs an extra Meta pixel.
- Use `server_only` when this is the sole sender. An omitted event ID is generated deterministically from site, source, activity ID and event name. Never change an ID on retry. Cross-source collisions on the same destination/name/ID are blocked. This protects Meta delivery, but does not merge two imported payment facts in attribution reports.
- The outcome and queued delivery commit together. Before the network request, the worker persists the attempt and payload. Retries preserve that snapshot, event time and ID. Timeouts are uncertain delivery, so retrying uses the same deduplication identity.
- Network failures, rate limits and transient Meta errors retry with exponential backoff, honoring `Retry-After`, at most eight attempts. Retries stop before 46 hours from the first attempt or seven days from the original event, whichever is earlier. Expired jobs require review; they are never silently assigned a fresh time or ID. Permanent errors stop for operator action.
- A receipt is accepted only when Meta returns success and acknowledges one event. It stores HTTP status, safe error codes and trace ID, not raw provider messages, matching hashes or tokens. Accepted means provider receipt, **not** person matching, ad attribution or performance improvement.
- Corrections before the first attempt can update the conversion. After any attempt, a changed destination or conversion payload stops further sending for review. Accepted receipts are retained and marked when their source changes. Tombstones, consent withdrawal or choosing an external sender stop future attempts; they cannot recall an event already sent or in flight. Handle any required downstream correction/deletion with Meta separately.
- Pausing or token rotation takes effect after restart. A token rotation for the same destination can safely resume eligible retries; changing dataset, mode or test code after an attempt requires review. Back up the database to retain deduplication history. Restoring an old database can lose newer receipts, so reconcile before resuming.

The sender targets Graph API `v25.0` with a ten-second request timeout. Source reference: [Meta server event SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/server-event.js), [Meta request SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/event-request.js). Check current platform requirements when upgrading.

## Run locally

Use Node **24.14.x** and pnpm. The bundled SQLite driver is experimental in this Node release; the runtime is pinned in Docker. This first release is a single-process, single-website deployment. Do not run multiple application replicas against the database.

1. Copy `.env.example` to `.env`.
2. Set your site ID, name and exact website origins (include `www` separately if needed).
3. Generate two independent secrets: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Repeat once. Set `KIT_READ_TOKEN` and `KIT_WRITE_TOKEN`.
4. Run `pnpm start` and open `http://localhost:4310`. Sign in with the **read** token.
5. Run `pnpm test` to verify the engine and actual HTTP/persistence flows.

For Docker, run `docker compose up --build -d` after configuring `.env`. The database uses a named volume. Stop the service before backing up the entire data directory/volume (including SQLite WAL files). Test restore with a separate deployment before depending on a backup. Reusing a database with another site ID is rejected.

For a public deployment, put an HTTPS reverse proxy in front of port 4310 and set `KIT_PUBLIC_URL` to that exact HTTPS origin. Ports bind to loopback by default. Set body limits and request throttles at the proxy too. Do not expose the SQLite volume, `.env`, write token or source control directory. Read and write tokens can be rotated by changing configuration and restarting; read-token rotation invalidates dashboard cookies.

## Install the pixel

```html
<script defer src="https://attribution.example.com/pixel.js" data-site="your-website"></script>
<form data-attribution-site="your-website">...</form>
```

No collection or browser storage begins by default. After the script loads and your consent manager permits collection:

```js
OpenAttribution.sites['your-website'].consent(true);
// On withdrawal:
OpenAttribution.sites['your-website'].consent(false);
```

If you only inject the script after consent, you may set `data-consent="granted"`. Global Privacy Control disables collection. For SPA route changes, call `.track()` after your router completes navigation; back/forward navigation is observed automatically. Tracking failures never block navigation or form submission. Blocked browser storage falls back to the current page's in-memory identity; it cannot preserve identity across pages.

The server returns an accepted `visitorSessionId`. `.getTrackingContext()` returns `{siteId, visitorSessionId}` or null; the `open-attribution:session` window event announces readiness. The form opt-in attribute adds a hidden `visitorSessionId` at submission. Save it with the CRM record. If it is unavailable, submit the form normally and leave attribution unlinked. A supplied session ID is evidence from the integration, not proof of a person's identity.

Campaign capture preserves standard and custom `utm_*` fields, common click IDs, and explicit campaign/ad IDs, including `hsa_*`, `gad_campaignid`, `h_ad_id`, `fbc_id` and `gc_id`. Values are bounded to 512 characters; numeric ad IDs remain strings. Sensitive UTM names, encoded email/credential values, and card-like values are rejected. Unknown query keys and fragments are removed before browser transmission. The first valid duplicate key wins. Referrers retain only their origin. Email-like path segments are redacted. Do not put names or other personal details in campaign labels or URL paths. This kit stores no IP addresses, browser fingerprints or resolved contact details. Literal placeholders such as `{campaignname}` are preserved as supplied; fix those in the ad platform's URL template.

## Import outcomes

From your trusted server, send `examples/payment.json` to `POST /v1/outcomes` with `Authorization: Bearer <write token>` and JSON content type. Replace the example times, session and source IDs with real evidence. The write token must never be installed in a website pixel or exposed in a browser.

- Stable `(source, externalId)` identifies one fact. An identical retry is `duplicate`.
- Corrections need a newer `sourceUpdatedAt`. Older revisions return `stale`. Changed data at the same revision returns 409.
- `occurredAt` is the original activity time, not upload time. Future source updates beyond five minutes are rejected.
- `deleted: true` is a tombstone correction; use the same stable ID and a newer source version.
- Money uses integer minor units with currency: `125050 USD` is $1,250.50; `125050 JPY` is ¥125,050. Zero is a known zero. Omitted amount/currency means unknown.
- Only **completed payments** count as revenue. Calls, bookings and won deal values do not become payments.
- Two independent systems reporting the same payment are not automatically deduplicated. Choose one source of truth for payment events.
- Full physical erasure/retention automation is not built into this first release. Operators own database lifecycle and backups; do not ingest unnecessary personal data.

The private API does not allow cross-origin browser access. Collection allows only configured origins, but origins are not proof of real traffic and can be forged by non-browser clients. Treat public collection as untrusted telemetry, never as an authenticated conversion.

## Calls: CallRail, Ringba or your own system

Send the normalized `examples/call.json` shape to `POST /v1/calls`. Provider account and call ID determine the stable record. `answered` becomes a completed call, never automatically a qualified lead or payment.

This is a bring-your-own-provider bridge, not a direct provider marketplace connection. Your trusted relay, Zapier or Make workflow normalizes the provider event and supplies the write token. Do not point a raw, unauthenticated provider webhook at this endpoint.

- **CallRail:** the bundled receiver, API refresh worker, browser cookie bridge and receipts are configured in [CALLRAIL.md](CALLRAIL.md). Use Post-Call and Call Modified events. Verify CallRail's `Signature` against the **raw request body**, using the company's signing key and HMAC-SHA1/base64 as documented. Pin the expected company. `examples/callrail-adapter.mjs` remains a pure mapper for custom middleware; the bundled connector performs authentication, current-state reads and durable versioning itself. CallRail's call start time is not a correction revision: do not use receipt time blindly, and do not let an older retried webhook overwrite newer state. Re-read authoritative provider data if versions are uncertain. [CallRail API](https://apidocs.callrail.com/)
- **Ringba:** configure its completed/finalized tracking pixel or use your existing automation. Map the documented `[Call:InboundCallId]` and `[Call:CallDateTime]`, plus explicit account, version and status, to our JSON. Bind the accepted browser session through your own integration; a phone number or similar timestamp alone is not a session match. [Ringba tokens](https://support.ringba.com/hc/en-us/articles/17993303467799-Most-Common-Tokens), [Ringba automation](https://support.ringba.com/hc/en-us/articles/17997458506135-Integromat)
- Qualification must come from an explicit disposition. Duration alone does not establish a qualified enquiry. Revenue should arrive separately from the authoritative payment system.

## Reports, tracking doctor and assistant tools

Authenticated GET endpoints:

- `/v1/report?from=<ISO>&to=<ISO>&model=last_non_direct`
- `/v1/doctor?from=<ISO>&to=<ISO>`
- `/v1/recovery?from=<ISO>&to=<ISO>`
- `/v1/export?cursor=<offset>` (500 outcome facts per page; pause imports for a consistent full export)

Ranges are inclusive start, exclusive end, at most 31 days. Attribution uses only visits before each outcome. First touch, last touch and last non-direct touch are supported. Internal navigation retains the entry source; a 30-minute gap or changed campaign starts a new touch. A direct-only journey remains Direct. Reports cap at 1,000 outcomes, 50 inspected browser histories and 5,000 inspected pageviews. Reaching a bound is disclosed, not silently presented as complete history.

Tracking doctor checks saved visits, source tags, outcome ingestion, linking, payment values and history coverage. It does not claim a fresh end-to-end test or Meta delivery. Recovery returns unconverted **browsers**, with no personal identity or outreach eligibility. A missing CRM import can create a false gap.

Connect an MCP client supporting authenticated Streamable HTTP to `https://your-server/mcp`, using the read token. The read-only tools are `get_attribution_report`, `check_tracking_health`, `get_unconverted_browsers`, and `get_meta_delivery_receipts`. The first three accept the same date range; receipts take no arguments. The endpoint supports JSON responses and MCP protocol `2025-06-18`; it does not implement OAuth discovery. Clients requiring OAuth need their own trusted bridge. No assistant action can spend money, send messages, or transmit ad conversions through these tools.

## PipelineOn-hosted equivalent

PipelineOn keeps its existing account, visibility, billing, enrichment and authorization controls. The equivalent read route is `GET /api/v1/attribution` with siteId and `traffic:read`, `customers:read`, `journeys:read`. Call imports use `POST /api/v1/calls` with `{siteId,call}`, `data:write`, and an `Idempotency-Key`; normal import rate limits and reconciliation apply. Stable call data lives in source `calls-callrail`, `calls-ringba` or `calls-other`. Contact references must belong to that same source.

Meta setup and receipt history are available on `/attribution`. A signed-in operator configures the website destination. `GET /api/v1/attribution/meta?siteId=...` and MCP `get_meta_delivery_receipts` require `customers:read`. Imported event records accept the same optional `meta` envelope through `data:write` authorization. Use JSON imports for the nested envelope. Read-only MCP connections cannot enqueue conversions; an authorized write integration is required.

Its report bounds are 100 outcomes, up to 1,000 candidate records in the date superset, and bounded existing journey lookups; every truncation is disclosed.

## Licence and contributions

Only this directory is MIT licensed. The surrounding PipelineOn application, provider integrations and private datasets are not included. Contributions should add a failing edge-case test before changing a public contract, avoid new runtime dependencies without justification, and preserve explicit unknown/partial evidence. Report security issues privately to the repository maintainer rather than posting secrets or customer records publicly.
