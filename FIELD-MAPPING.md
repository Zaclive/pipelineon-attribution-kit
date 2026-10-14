# Rename CRM fields into consistent outcomes

Keep the CRM's original fields and translate their meaning in an adapter. Renaming cannot turn an account note into a job, an estimate into collected revenue or a button click into a saved enquiry.

Complete [crm-mapping.template.json](examples/crm-mapping.template.json) for each source/client using an authorized API sample and schema. This is an adapter design worksheet, not executable kit configuration or an API request. Display names vary by CRM account and language.

## Map the business meaning first

| Evidence | Normalized fact | Meta mapping in v0.3 |
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

`qualified_lead`, `job_won`, `Purchase` and provider stage names are not valid `eventType` values in the v0.3 contract. Use the canonical names in [EVENTS.md](EVENTS.md) through /v1/events, or translate into the supported low-level fact. An explicit canonical job_won maps to stage_change/completed and never to a payment. Do not relabel an unsupported fact as payment to force delivery.

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
| `meta` | Optional separate advertising envelope in the [README](README.md#send-eligible-outcomes-to-meta). |

The standalone payload rejects extra keys. PipelineOn adds `kind`, relationships and a batch wrapper; see [INTEGRATIONS.md](INTEGRATIONS.md#4-send-to-the-correct-front-door). Do not send one product's wrapper to the other.

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

Complete the worksheet, implement against real fields, validate a sample against the installed contract, then run [ACCEPTANCE.md](ACCEPTANCE.md). A completed worksheet alone is not a connector.
