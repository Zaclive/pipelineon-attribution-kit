# API and reporting reference

Use the contract shipped with your installed version. The kit and hosted PipelineOn use different request wrappers. Start with the [setup guide](setup.md) for installation.

For new adapters, the [canonical events endpoint](events.md) accepts named business facts. The low-level endpoints below remain supported. Advertising requests use independent [Meta](meta.md) and [Google Ads](google-ads.md) envelopes.

## Send to the correct API

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

Replace all example IDs, dates and values. This request records a payment. It requests no advertising delivery without a `meta` or `googleAds` envelope. The kit uses stable source/object IDs and revisions for inbound idempotency. Inspect response status: `created`, `updated`, `duplicate` or `stale`. A changed payload at the same revision is a conflict, not a successful correction.

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

Both products accept the optional `meta` and `googleAds` envelopes, but their HTTP wrappers and receipts are different. Do not send the hosted wrapper to the standalone endpoint.

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

- **CallRail:** the bundled receiver, API refresh worker, browser cookie bridge and receipts are configured in [callrail guide](callrail.md). Use Post-Call and Call Modified events. Verify CallRail's `Signature` against the **raw request body**, using the company's signing key and HMAC-SHA1/base64 as documented. Pin the expected company. `examples/callrail-adapter.mjs` remains a pure mapper for custom middleware; the bundled connector performs authentication, current-state reads and durable versioning itself. CallRail's call start time is not a correction revision: do not use receipt time blindly, and do not let an older retried webhook overwrite newer state. Re-read authoritative provider data if versions are uncertain. [CallRail API](https://apidocs.callrail.com/)
- **Ringba:** configure its completed/finalized tracking pixel or use your existing automation. Map the documented `[Call:InboundCallId]` and `[Call:CallDateTime]`, plus explicit account, version and status, to our JSON. Bind the accepted browser session through your own integration; a phone number or similar timestamp alone is not a session match. [Ringba tokens](https://support.ringba.com/hc/en-us/articles/17993303467799-Most-Common-Tokens), [Ringba automation](https://support.ringba.com/hc/en-us/articles/17997458506135-Integromat)
- Qualification must come from an explicit disposition. Duration alone does not establish a qualified enquiry. Revenue should arrive separately from the authoritative payment system.

## Reports, tracking doctor and assistant tools

Authenticated GET endpoints:

- `/v1/report?from=<ISO>&to=<ISO>&model=last_non_direct`
- `/v1/doctor?from=<ISO>&to=<ISO>`
- `/v1/recovery?from=<ISO>&to=<ISO>`
- `/v1/export?cursor=<offset>` (500 outcome facts per page; pause imports for a consistent full export)

Ranges are inclusive start, exclusive end, at most 31 days. Attribution uses only visits before each outcome. First touch, last touch and last non-direct touch are supported. Internal navigation retains the entry source; a 30-minute gap or changed campaign starts a new touch. A direct-only journey remains Direct. Reports include all saved outcomes in the period, with paginated reads in hosted PipelineOn. A safety budget of 100,000 rows per evidence scan rejects oversized reports with `REPORT_TOO_LARGE` and no partial totals. Narrow the period if needed. The standalone kit inspects up to 5,000 visits per browser; hosted journey lookups retain their own per-batch bounds. Incomplete browser history is disclosed separately from complete activity totals. Reads are not an atomic snapshot: pause imports for a reproducible reconciliation.

`totals.outcomes` and `linkedOutcomes` retain their original all-activity meaning for export/API compatibility. Additive `conversions`, `stageChanges` and `otherActivities` partition activity totals. Conversions count received or completed forms, calls, bookings and payments; these are events, not unique leads, qualified leads or advertising-platform conversions. Missed/failed/unknown calls and other event types remain other activity. `linkedConversions` and `unlinkedConversions` apply only to this conversion subset. Stage changes, including won deals, are never payments.

Source groups include `campaignIds`, `campaignConflict` and a stable `groupId`. The selected touch's `utm_campaign` is displayed when present, otherwise saved campaign IDs are shown. All conflicting values remain visible and no winner is guessed. Numeric `utm_campaign` values are compared with saved IDs; names are not compared with IDs. Click IDs are never displayed in campaign metadata. Google Ads requires positive paid evidence such as Google click IDs, Google campaign tags or a Google source with a paid medium. Google referral means Google referred the visit without saved paid evidence, not proof of organic traffic; an unclassified Google tag remains unclassified. Explicit organic tags are labelled separately. Original traffic labels and saved touches remain unchanged.

Tracking doctor checks saved visits, source tags, outcome ingestion, linking, payment values and history coverage. It does not claim a fresh end-to-end test or Meta delivery. Recovery returns unconverted **browsers**, with no personal identity or outreach eligibility. A missing CRM import can create a false gap.

Connect an MCP client supporting authenticated Streamable HTTP to `https://attribution.example.com/mcp`, using the read token. The read-only tools are `get_attribution_report`, `check_tracking_health`, `get_unconverted_browsers`, and `get_meta_delivery_receipts`. The first three accept the same date range; receipts take no arguments. The endpoint supports JSON responses and MCP protocol `2025-06-18`; it does not implement OAuth discovery. Clients requiring OAuth need their own trusted bridge. No assistant action can spend money, send messages, or transmit ad conversions through these tools.

## PipelineOn-hosted equivalent

The hosted read route is `GET /api/v1/attribution` with siteId and `traffic:read`, `customers:read`, `journeys:read`. Call imports use `POST /api/v1/calls` with `{siteId,call}`, `data:write`, and an `Idempotency-Key`; normal import rate limits and reconciliation apply. Stable call data lives in source `calls-callrail`, `calls-ringba` or `calls-other`. Contact references must belong to that same source.

Meta setup and receipt history are available on `/attribution`. A signed-in operator configures the website destination. `GET /api/v1/attribution/meta?siteId=...` and MCP `get_meta_delivery_receipts` require `customers:read`. Imported event records accept the same optional `meta` envelope through `data:write` authorization. Use JSON imports for the nested envelope. Read-only MCP connections cannot enqueue conversions; an authorized write integration is required.

Hosted reports paginate all saved outcomes in the requested period and reject oversized evidence scans with `REPORT_TOO_LARGE`; they do not return the earliest 100 outcomes. Existing per-batch journey bounds remain in place and incomplete visit evidence is disclosed separately from full activity totals.

The kit accepts at most 64 KiB per request. `visitorSessionId` must be a valid UUID or null/omitted; an empty string is invalid. Normalize an empty form field before importing. Keep successful enquiries even when tracking is unavailable.
# Person identity links

`POST /v1/identities/hubspot` requires the write token and an already imported, verified form enquiry. Its body is `{ "source": "hubspot_main", "externalId": "enquiry-001", "accountId": "123", "contactId": "101" }`. It returns a stable site-owned `personId` and `duplicate` flag. It does not create a HubSpot contact or grant CRM access. Use one outcome source per portal. Read the full [identity evidence and correction contract](people.md) before connecting an adapter. `/v1/report` includes up to 100 `people` snapshots alongside the aggregate `report`.
