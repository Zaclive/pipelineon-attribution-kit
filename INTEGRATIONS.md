# Connect a CRM, your backend or an automation tool

New installation? Follow [START-HERE.md](START-HERE.md), use [PIXEL-EVENTS.md](PIXEL-EVENTS.md) for the website and complete [FIELD-MAPPING.md](FIELD-MAPPING.md) before building the adapter. [AI-SETUP.md](AI-SETUP.md) contains the task to give a coding assistant.

The connection is: **website visit → enquiry → business outcome → attribution → Meta receipt**. Your connector supplies the enquiry and outcome records. This kit supplies collection, attribution, an outcome API and optional Meta and Google Ads delivery. Use [canonical business events](EVENTS.md) and the [Google Ads setup guide](GOOGLE-ADS.md) for the shared event contract and independent Google destination. You can use the same design with PipelineOn hosting.

Start with the [README](README.md) to install the kit. Use [CRM access options](CRM-ACCESS.md) to choose a provider and the [CallRail guide](CALLRAIL.md) for calls. The CallRail guide covers the bundled connector; other provider mappings remain adapter work. An API key authorizes a connection; it does not perform synchronization by itself.

## Choose who runs the connection

| Arrangement | What the customer installs | Who operates the connector |
| --- | --- | --- |
| Self-hosted kit | Pixel on the website; kit on an always-on server; CRM adapter or workflow | Customer or agency operates HTTPS, credentials, backups, polling/webhook processing and failure alerts. |
| PipelineOn hosted | PipelineOn pixel; a site-scoped API connection; CRM adapter or supported connector | PipelineOn operates its tracking/outcome/Meta services. The custom adapter still needs an operator. A native CRM sync is not automatically an outcome feed. |
| Automation tool | Either pixel plus a CRM trigger and authenticated HTTP action in n8n, Make, Zapier or another tool | Automation provider hosts the workflow, or the agency self-hosts it. The workflow must meet the receipt, retry and mapping requirements below. |

The self-hosted kit uses Node 24.14 or newer within Node 24, one process, one website and persistent SQLite storage. Follow the README's Docker or Node setup. Do not place its database on ephemeral function storage or run several replicas against it. For multiple clients, use isolated deployments and secrets or implement a properly isolated multi-tenant service. A website-only static host cannot run the worker and database. MIT licensing removes the kit's licence fee; hosting, CRM API plans, automation usage and call-provider charges remain separate.

The middle layer can be a small service or an existing workflow. It needs a durable inbox/outbox, a scheduler, a credential store and a mapping between source records and visitor sessions. If an automation tool cannot authenticate raw webhooks or retain retry state, put a small receiver in front of it. No particular middleware vendor is required.

## 1. Carry the accepted browser reference into the enquiry

Use the pixel's public interface, after the collector accepts the visit:

```js
// Self-hosted kit: use the configured KIT_SITE_ID.
const context = window.OpenAttribution?.sites['your-website']?.getTrackingContext();
const visitorSessionId = context?.visitorSessionId ?? null;
```

PipelineOn's equivalent is `window.PipelineOn?.getTrackingContext('YOUR_PIXEL_TAG')`. Its readiness event is `pipelineon:session`; the kit's is `open-attribution:session`. Filter by the intended tag/site when a page contains more than one installation. Readiness does not grant consent.

Save the reference in an enquiry/form field named `visitorSessionId`, or a CRM custom field with a documented mapping to that name. The kit can populate opted-in forms using `data-attribution-site`, as described in the README. Carry the enquiry reference into related bookings and payments. Keep it per enquiry or job; overwriting a contact's field with their latest visit can reattribute older jobs incorrectly.

The tracker already stores campaign observations. Do not copy a current UTM value into every historical event or append arbitrary UTM fields to the strict outcome API. Where the CRM needs source fields, keep first touch and last touch separate and preserve the original values alongside your mapping.

If tracking is blocked, consent is absent, the form is in an inaccessible iframe, or the session has not been accepted, let the enquiry complete and leave its session empty. Never invent a session, join different customer accounts, or infer a browser from a similar IP, phone number or timestamp. A CRM contact ID alone is not a browser reference in the standalone kit.

## 2. Read the actual outcome from the source

Configure one of these routes:

- **Provider webhook:** authenticate the raw request, verify the account/company, persist it before acknowledging, then process asynchronously. Re-read authoritative provider state when webhooks contain incomplete data or lack reliable revisions.
- **API polling:** use the customer's permitted credentials, follow pagination, keep a durable cursor and overlap the update window. Advance the cursor only after records have been durably queued. Reconcile missed changes periodically.
- **CRM workflow:** trigger on the specific transition, read its actual object IDs and timestamps, and call the authenticated outcome endpoint. Persist failed runs so retries survive restarts.
- **File or existing backend:** transform records using the same contract. Old records can support attribution history but may be too old for Meta delivery.

Start with read-only source permissions plus any explicitly needed enquiry custom-field write. Keep secrets on the server. Choose the destination website from saved integration configuration, never from an untrusted webhook's `siteId`. Separate credentials, mappings and queues for each client.

## 3. Map facts, not guesses

| Field | Requirement |
| --- | --- |
| `source` | Stable lowercase namespace, such as `my-crm`. Keep tenant/company separation in the integration configuration and object identifiers. |
| `externalId` | Stable ID for this activity, preferably including source account and object type. A contact or job can have many activities. Each payment needs its own ID. |
| `eventType`, `outcome` | Actual fact: `form`/`received`, `booking`/`completed`, `call`/`completed` or `payment`/`completed`, for example. |
| `occurredAt` | Original business activity timestamp, including timezone. Never substitute the retry time. |
| `sourceUpdatedAt` | Authoritative revision timestamp, unchanged on replay. A newer correction must advance it. |
| `visitorSessionId` | Accepted reference carried from that enquiry, or null. |
| `qualification` | Explicit `qualified`, `unqualified` or `unknown`. An answered or long call is not automatically qualified. |
| `amountMinor`, `currency` | Actual payment amount in integer minor units and uppercase currency. Send both or neither. USD 1,250.50 is `125050` and `USD`. |
| `meta` | Optional, explicit delivery instruction and permissioned matching data. See step 5. |

A won deal or signed estimate is not a completed payment. Unknown revenue is not zero. Handle deposits and later payments as distinct transactions, and choose one authoritative system for each payment. Do not import the same transaction as both a CRM payment and a processor payment. A refund is not another positive purchase; refund reporting and ad-platform retractions need a separate design.

If the provider lacks a usable revision timestamp, the adapter must maintain its own durable version ledger: serialize refreshes per source object, fetch current state, compare normalized content and assign a new revision only for a changed state. Preserve it on retries. A delayed webhook must not be assigned a newer version merely because it arrived later. If the API's consistency cannot support this, hold the conflict for reconciliation.

## 4. Send to the correct front door

### Self-hosted kit

`POST https://attribution.example.com/v1/outcomes` accepts one outcome, with `Authorization: Bearer <KIT_WRITE_TOKEN>` and `Content-Type: application/json`.

```json
{
  "source": "my-crm",
  "externalId": "company-1:payment:123",
  "eventType": "payment",
  "occurredAt": "2026-10-14T00:00:00Z",
  "sourceUpdatedAt": "2026-10-14T00:01:00Z",
  "outcome": "completed",
  "visitorSessionId": "44444444-4444-4444-8444-444444444444",
  "amountMinor": 125050,
  "currency": "USD"
}
```

Replace all example IDs, dates and values. This request records a payment; it does not request Meta delivery until you add `meta`. The kit uses stable source/object IDs and revisions for inbound idempotency. Inspect response status: `created`, `updated`, `duplicate` or `stale`. A changed payload at the same revision is a conflict, not a successful correction.

### PipelineOn hosted

`POST https://app.pipelineon.com/api/v1/imports` requires a site-authorized bearer key with `data:write`, `Content-Type: application/json` and an `Idempotency-Key` containing 8–128 letters, digits, underscores or hyphens. Reuse the same key for an exact request retry; use a new key for a changed batch/revision. The hosted API uses a batch wrapper and additional record fields:

```json
{
  "siteId": "11111111-1111-4111-8111-111111111111",
  "source": "my-crm",
  "sourceName": "My CRM outcomes",
  "records": [
    {
      "kind": "event",
      "externalId": "company-1:payment:123",
      "sourceCreatedAt": "2026-10-14T00:00:00Z",
      "sourceUpdatedAt": "2026-10-14T00:01:00Z",
      "deleted": false,
      "contactIds": [],
      "propertyId": null,
      "opportunityId": null,
      "eventType": "payment",
      "occurredAt": "2026-10-14T00:00:00Z",
      "direction": "inbound",
      "outcome": "completed",
      "label": "Payment received",
      "detail": "",
      "visitorSessionId": "44444444-4444-4444-8444-444444444444",
      "amountMinor": 125050,
      "currency": "USD"
    }
  ]
}
```

Use your real website UUID and its accepted PipelineOn session reference. Contact/property/opportunity references must exist in the same source namespace; do not copy IDs from another connector and assume they resolve. Up to 500 records fit a batch; normal authorization, import and billing controls still apply. Use `?dryRun=true` for hosted import validation before writing. Inspect the import result and then read back the stored outcome; a received request is not proof of linkage or Meta delivery.

Both products accept the same optional `meta` envelope, but their HTTP wrappers and receipts are different. Do not send the hosted wrapper to the standalone endpoint.

## 5. Assign a Meta sender and configure its destination

Follow [Meta setup and envelope fields](README.md#send-eligible-outcomes-to-meta). Add the envelope to the standalone outcome or hosted event record. Configure the self-hosted dataset/token in server environment variables, or configure the website's destination in PipelineOn. Keep these credentials out of the pixel and CRM custom fields.

The adapter must supply explicit measurement consent and permitted matching data. Hash normalized customer-provided email/phone identifiers; do not hash observed `fbp`/`fbc`. UTM values and our session reference do not establish Meta identity. The kit does not automatically extract Meta cookies. Use the actual conversion origin, such as `phone_call`, and retain original event time. Consent unknown means do not request delivery; the envelope accepts `granted` or `denied`, not an invented third value.

Choose one sender per logical conversion. If the CRM or call provider already sends it, either keep that sender and set `deliveryOwner: "external"`, or disable that exact event mapping there before making this system the owner. Coordinate the same `eventId` and Meta event name when the browser also sends the conversion. There is no universal check that discovers another integration's previous events. Sending two different IDs and hoping Meta recognizes them is not a deduplication strategy.

Enable test mode, submit a recent synthetic event and inspect the persisted receipt plus Events Manager Test Events. Meta acceptance is separate from identity matching, campaign attribution and improved ad performance. Read-only assistant tools can inspect reports and receipts; they do not create missing CRM synchronization.

## 6. Operate the middle layer

Keep a receipt for each stage: provider event/object → normalized record/version → ingestion response → linked outcome → Meta delivery ID/status. Redact credentials and raw personal data from logs. Monitor queue age, repeated authentication failures, expired keys, missing session links, missing amounts and permanent Meta failures.

Retry network errors, rate limits and temporary server failures with bounded exponential backoff and provider `Retry-After` guidance. Preserve IDs, event time and payload. Do not blindly retry invalid input, revoked credentials or conflicting revisions. An uncertain HTTP timeout requires replay/readback using the same identity, not creation of a new event ID. The kit has an outbound Meta queue; your adapter still owns inbound delivery retries.

Meta eligibility is bounded by original event age. Old backfills and corrections must not be disguised as fresh conversions. The README explains the kit's seven-day event age limit, bounded retry window and behavior after an accepted delivery. Correcting local revenue does not retroactively change an accepted Meta purchase.

## Acceptance checklist

1. A tagged visit reaches the collector and its accepted session reaches the enquiry.
2. A second campaign visit preserves distinct first/last-touch evidence.
3. A real test booking or payment preserves source IDs, original time and exact currency/amount.
4. The outcome is linked to the correct website and prior visit; missing evidence remains unlinked.
5. Duplicate delivery, delayed older updates and a restart do not duplicate facts or revenue.
6. Unknown consent, another active sender and incomplete matching data stop inappropriate Meta dispatch.
7. A recent synthetic conversion gets a persisted Meta receipt and appears in Test Events; replay does not create another conversion.
8. Credentials revoked or rotated, provider rate limits, multi-page polling and permanent errors have visible recovery paths.
9. Blocked tracking never prevents a form submission, phone call, booking or checkout.

Complete this for each provider and customer configuration before describing the connection as working.
