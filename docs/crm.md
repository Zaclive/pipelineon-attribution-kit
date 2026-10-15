# Connect and normalize CRM outcomes

Use [canonical business events](events.md) when starting a new adapter; `/v1/outcomes` remains supported. Save the accepted visitor reference on the enquiry, map confirmed business activity, then send it to the outcome API. An API key authorizes access; the connector or workflow performs the synchronization.

## Choose the connection route

Offline means the business result can happen after the website session, by phone, in a job system or in person. Keep its actual occurrence time and action source. Preserve the original enquiry's browser reference when known; a truly offline record can remain unlinked locally while having its own permitted Meta matching data.

Choose the least complex supported route:

| Source capability | Route and steps |
| --- | --- |
| Supported native connector | Connect the correct account/site, check which activities it already imports, and verify one real record. Use the bundled [CallRail](callrail.md) instructions or PipelineOn's available native integration. |
| CRM workflow with authenticated HTTP | Trigger on a confirmed business change, look up related enquiry/session fields, map the outcome, POST to the correct API, retain the response and retry transient failures. |
| Existing backend or Make/n8n/Zapier workflow | Fetch authoritative source data, map using [the field rules below](#map-the-contract-fields), and send via an HTTP action with server-side credentials. Keep a durable retry/reconciliation record. This is generic HTTP, not a bundled native app. |
| CSV export | Map rows into outcome JSON using a CSV parser; validate and import in controlled batches. See the example below. The kit does not accept raw CSV at `/v1/outcomes`. |
| Provider webhooks or polling need custom code | Build an authenticated adapter on your server, Railway or Workers with a durable inbox, field mapping, revisions and receipts. The optional pixel proxy does not implement it. |

## Carry the accepted browser reference into the enquiry

Use the pixel's public interface, after the collector accepts the visit:

```js
// Self-hosted kit: use the configured KIT_SITE_ID.
const context = window.OpenAttribution?.sites['your-website']?.getTrackingContext();
const visitorSessionId = context?.visitorSessionId ?? null;
```

PipelineOn's equivalent is `window.PipelineOn?.getTrackingContext('YOUR_PIXEL_TAG')`. Its readiness event is `pipelineon:session`; the kit's is `open-attribution:session`. Filter by the intended tag/site when a page contains more than one installation. Readiness does not grant consent.

Save the reference in an enquiry/form field named `visitorSessionId`, or a CRM custom field with a documented mapping to that name. The kit can populate opted-in forms using `data-attribution-site`, as described in the [pixel guide](pixel.md#carry-the-reference-into-the-enquiry). Carry the enquiry reference into related bookings and payments. Keep it per enquiry or job; overwriting a contact's field with their latest visit can reattribute older jobs incorrectly.

The tracker already stores campaign observations. Do not copy a current UTM value into every historical event or append arbitrary UTM fields to the strict outcome API. Where the CRM needs source fields, keep first touch and last touch separate and preserve the original values alongside your mapping.

If tracking is blocked, consent is absent, the form is in an inaccessible iframe, or the session has not been accepted, let the enquiry complete and leave its session empty. Never invent a session, join different customer accounts, or infer a browser from a similar IP, phone number or timestamp. A CRM contact ID alone is not a browser reference in the standalone kit.

Complete a private copy of [the mapping worksheet](../examples/crm-mapping.template.json) for each source. Record the real API field names and relationships. Never commit a completed customer worksheet to this public repository.

## Map the business meaning first

| Evidence | Normalized fact | Meta mapping |
| --- | --- | --- |
| Saved enquiry | `form` / `received` | Eligible `Lead`. |
| Confirmed appointment | `booking` / `completed` | Eligible `Schedule`. |
| Answered and explicitly qualified call | `call` / `completed`, qualification `qualified` | Eligible `Lead`; native CallRail additionally requires an inbound call. |
| Answered call of unknown quality | `call` / `completed`, qualification `unknown` | No call Lead. |
| Missed call | `call` / `missed` | No conversion mapping. |
| Issued/accepted estimate | `estimate` / `completed`, accurate label | No built-in Meta mapping. |
| Opportunity becomes won | `stage_change` / `completed`, transition label | No built-in Meta mapping. |
| Money actually collected | `payment` / `completed`, amount and currency | Eligible `Purchase`. |
| Contact, deal or job note | `note` / `received`, non-sensitive label | No built-in Meta mapping. |

Eligibility also requires an explicit Meta envelope, consent, matching data, a configured destination and acceptable event age. Changing a label never overrides the Meta event name.

`qualified_lead`, `job_won`, `Purchase` and provider stage names are not valid low-level `eventType` values. Use the [canonical event names](events.md) through `/v1/events`, or map them to a supported low-level fact. Canonical `job_won` is a stage change, never a payment. Do not relabel an unsupported fact as payment to force delivery.

Allowed event types: `call`, `form`, `estimate`, `booking`, `payment`, `email`, `sms`, `postcard`, `note`, `stage_change`. Outcomes: `received`, `completed`, `missed`, `failed`, `unknown`. Qualification: `qualified`, `unqualified`, `unknown`. Direction: `inbound`, `outbound`, `unknown`.

## Map the contract fields

| Field | Mapping rule |
| --- | --- |
| `source` | Stable lowercase namespace, max 64 characters, pattern `[a-z0-9][a-z0-9_-]*`. |
| `externalId` | Stable activity ID, max 200 characters. Include source account/type if needed, e.g. `acme:payment:123`. A contact ID is not a unique payment ID. |
| `eventType`, `outcome` | Actual business fact from the table, using documented source states. |
| `occurredAt` | Original event time, ISO 8601 with timezone. |
| `sourceUpdatedAt` | Authoritative revision time, at or after `occurredAt`. Preserve on replay; advance for genuine corrections. |
| `visitorSessionId` | Accepted reference on the relevant enquiry/job, or null. Never an email, phone, invented UUID or unrelated latest visit. |
| `amountMinor`, `currency` | Both present or both absent/null. Non-negative integer minor units and uppercase currency. USD 1250.50 becomes `125050` / `USD`; JPY 1250 becomes `1250` / `JPY`. Unknown is not zero. |
| `qualification`, `direction` | Actual disposition/direction; preserve unknowns. |
| `label` | Non-sensitive readable description, max 300 characters. Not an event-name override. |
| `contactIds` | Optional source-local references. Alone, they do not link a browser in the kit. |
| `deleted` | Boolean tombstone for the same ID with a newer revision. Not a refund instruction. |
| `googleAds` | Optional independent envelope in the [Google Ads guide](google-ads.md). |
| `businessEvent` | Optional canonical meaning consistent with the low-level fields. Prefer `/v1/events` for new canonical imports. |
| `meta` | Optional separate advertising envelope in the [Meta guide](meta.md#send-eligible-outcomes-to-meta). |

The standalone payload rejects extra keys. PipelineOn adds `kind`, relationships and a batch wrapper; see the [API reference](api.md#send-to-the-correct-api). Do not send one product's wrapper to the other.

## Discover each CRM object and relationship

For HubSpot, GoHighLevel, Workiz or another CRM, locate the account's actual enquiry, job/opportunity, appointment, payment and note/activity records. This worksheet does not presume their API field names are the same:

| Question | Record in the worksheet |
| --- | --- |
| Is this note on the contact, deal or job? | Object type, ID and parent reference. It remains a note. |
| Where does the form save the session? | Exact custom-field API ID/path on the enquiry/job. |
| How does the payment/booking relate to the enquiry? | Foreign key, lookup and behavior for missing/multiple matches. |
| What establishes qualification or a booking? | Exact status IDs and the customer's definition. |
| Which object proves collected revenue? | Transaction ID, settled state, amount/currency fields and units. |
| What orders corrections? | Source revision time, or a durable version ledger using current-state reads. |

A workflow, backend or Worker can implement the mapping. It still needs source authentication, reliable delivery and reconciliation. You do not need to move the customer's entire CRM into the kit.

## Preserve identity and history

For the kit, an identical `(source, externalId, sourceUpdatedAt)` replay returns `duplicate`; an older revision returns `stale`; changed content at the same revision returns 409. Do not stamp every retry with the current time.

Give distinct payments/bookings/transitions distinct occurrence IDs. Keep an activity's ID for its corrections. If notifications are incomplete, serialize refreshes and fetch authoritative current state. Maintain a durable content/version ledger rather than trusting webhook arrival order.

Deposits and balances are distinct transactions. Choose either CRM or processor as payment authority. A refund, cancellation or deleted record is not an additional positive purchase. Automated refund reporting and advertising retraction are outside this contract.

## Keep acquisition and matching data separate

Suggested CRM custom-field labels are `po_visitor_session_id`, `po_first_utm_source`, `po_last_utm_source`, `po_first_utm_campaign`, `po_last_utm_campaign`. They are not built-in fields or extra outcome keys. Record their real API IDs, retain original values and evaluate source history before the relevant outcome time.

UTMs explain acquisition. Meta matching uses permissioned matching identifiers. `fbclid` is a click parameter, `_fbc`/`fbc` is matching context, and the legacy `fbc_id` campaign parameter is not a substitute. Never hash UTMs as a stand-in for a person.

Record one server sender per conversion. Browser/server copies need the same dataset, mapped event name and event ID. There is no universal lookup for every conversion another integration sent. Use `deliveryOwner: "external"` when keeping another sender.

Complete the worksheet, implement against real fields, validate a sample against the installed contract, then run [verification checklist](verify.md). A completed worksheet alone is not a connector.

## Read the actual outcome from the source

Configure one of these routes:

- **Provider webhook:** authenticate the raw request, verify the account/company, persist it before acknowledging, then process asynchronously. Re-read authoritative provider state when webhooks contain incomplete data or lack reliable revisions.
- **API polling:** use the customer's permitted credentials, follow pagination, keep a durable cursor and overlap the update window. Advance the cursor only after records have been durably queued. Reconcile missed changes periodically.
- **CRM workflow:** trigger on the specific transition, read its actual object IDs and timestamps, and call the authenticated outcome endpoint. Persist failed runs so retries survive restarts.
- **File or existing backend:** transform records using the same contract. Old records can support attribution history but may be too old for Meta delivery.

Start with read-only source permissions plus any explicitly needed enquiry custom-field write. Keep secrets on the server. Choose the destination website from saved integration configuration, never from an untrusted webhook's `siteId`. Separate credentials, mappings and queues for each client.

## Import a file or API record

Example source row: `transaction_id=pay_123`, `job_id=job_55`, `paid_at=2026-10-14T00:00:00Z`, `updated_at=2026-10-14T00:01:00Z`, `paid_amount=1250.50`, `currency=USD`, `status=settled`. Resolve `job_55` to its original enquiry session and normalize:

```json
{
  "source": "my-crm",
  "externalId": "company-1:payment:pay_123",
  "eventType": "payment",
  "outcome": "completed",
  "occurredAt": "2026-10-14T00:00:00Z",
  "sourceUpdatedAt": "2026-10-14T00:01:00Z",
  "visitorSessionId": null,
  "amountMinor": 125050,
  "currency": "USD"
}
```

The null above means the join is unknown; replace it only with the accepted session from that enquiry. Use exact decimal-to-minor-unit conversion, not binary float multiplication. Preserve source IDs/times on retries. Use a private QA copy with current synthetic times for Meta testing; never redate historical customer payments. Keep refunds, notes, won opportunities and bookings separate from collected payments.

The kit receives one such object at `POST /v1/outcomes` using `KIT_WRITE_TOKEN`. PipelineOn needs the batch wrapper, `kind: "event"`, website ID and stable `Idempotency-Key` in [CRM integration guide](api.md#send-to-the-correct-api). Validate first, retain one result per row, and stop on conflicting revisions. Neither CSV parsing nor a worksheet automatically interprets arbitrary CRM field meanings.

## Optional Cloudflare CRM relay

The repository does not contain a ready-made generic CRM Worker. The kit's Node HTTP server and filesystem-backed SQLite store require an actual port to Workers storage/runtime, not merely a compatibility flag. See [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

```text
CRM webhook -> verified Worker receiver -> durable Queue
              -> consumer and revision ledger -> kit OR PipelineOn outcome API
              -> attribution and optional Meta queue
```

Give the assistant these implementation requirements when Cloudflare is your chosen adapter host:

1. Create the Worker, queue, consumer, dead-letter recovery and durable storage for object revisions, polling cursors and receipts. Follow the current [Cloudflare Queues guide](https://developers.cloudflare.com/queues/get-started/).
2. Put CRM credentials, webhook verification secrets and destination tokens in [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/). Pin destination origin and tenant/site in server configuration; never take an arbitrary forwarding URL or site from the request body.
3. Verify the provider's documented authentication over original bytes before parsing/mutation. Enforce its replay/timestamp protection when supplied, body limits and expected account. Without authenticated webhooks, use supported authenticated polling or another trusted route.
4. Await durable enqueue before acknowledgement. Retain only needed references/minimized data. A promise or `waitUntil` task alone is not a durable inbox. Do not log raw requests or authorization headers.
5. Re-read authoritative state when necessary, apply [the field rules](#map-the-contract-fields) and send the correct destination wrapper. Preserve activity IDs, original times and revisions across retries.
6. Acknowledge successful processing only after checking the importer result. Retry transient failures with bounded backoff and retain permanent failures for recovery. Reconcile missed webhooks and paginated API updates.
7. Test duplicates, out-of-order updates, revoked access, restart recovery and tenant isolation using [verification checklist](verify.md).

A Queue receipt proves enqueue only; outcome and Meta receipts prove later stages. Hosting, CRM/API access and provider usage can incur charges despite the MIT licence.

Scaffold a separate adapter project with `pnpm create cloudflare@latest`. Store source/write credentials with `pnpm exec wrangler secret put NAME` in that project. This is a source-specific connector you implement; the pixel proxy does not implement these receiver or queue requirements.

## Operate the middle layer

Keep a receipt for each stage: provider event/object → normalized record/version → ingestion response → linked outcome → Meta delivery ID/status. Redact credentials and raw personal data from logs. Monitor queue age, repeated authentication failures, expired keys, missing session links, missing amounts and permanent Meta failures.

Retry network errors, rate limits and temporary server failures with bounded exponential backoff and provider `Retry-After` guidance. Preserve IDs, event time and payload. Do not blindly retry invalid input, revoked credentials or conflicting revisions. An uncertain HTTP timeout requires replay/readback using the same identity, not creation of a new event ID. The kit has an outbound Meta queue; your adapter still owns inbound delivery retries.

Meta eligibility is bounded by original event age. Old backfills and corrections must not be disguised as fresh conversions. The [Meta guide](meta.md#deduplication-retries-and-corrections) explains the kit's seven-day event age limit, bounded retry window and behavior after an accepted delivery. Correcting local revenue does not retroactively change an accepted Meta purchase.

Run the [end-to-end checks](verify.md) for every source configuration. Use [CRM access options](crm-access.md) and [CallRail setup](callrail.md) where relevant.

## Reconcile confirmed forms with saved browser evidence

PipelineOn can link a confirmed HubSpot form using its exact submitted email, the same website/page and a submission time within two minutes of saved first-party form evidence. This stores an attribution link independently of prospect recovery, lead unlocks and identity purchases. It preserves the original CRM event time and conversion ID. Multiple matching browser sessions or shared email identities remain ambiguous. Phone, household and time proximity alone do not establish a link.

For a self-hosted adapter, `formIdentityEmails` and `matchFormVisit` are exported from `core/index.mjs`. Derive identity keys on your trusted backend, check current CRM permissions and identity uniqueness, and supply only confirmed submissions from the same website. Persist the returned session against the original source event. The helpers do not authenticate a CRM or store a link for you.

Prefer carrying the accepted browser reference through the enquiry as described above. For custom JavaScript form submission, explicitly map that reference into your backend payload; a hidden input alone does not change a custom JSON request. Missing context must not block the form. Only visits before an outcome receive acquisition credit.

The MIT server receives outcomes through its authenticated API; your backend or CRM adapter completes this handoff. Test a tagged visit, successful form, CRM contact and outcome together, including consent denial, missing context, retries and later visits. See [verification](verify.md).
