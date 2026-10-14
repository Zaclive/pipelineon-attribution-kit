# Business events, without GTM

The browser script collects consented source observations and returns an accepted `visitorSessionId`. Your backend or trusted CRM connector records confirmed business facts. Those facts enter one attribution contract and can optionally request Meta or Google Ads delivery. GTM is optional. A browser click is not proof that a form succeeded, a job was won or a payment settled.

## Canonical names

Send `POST /v1/events` with the server-side write token. The PipelineOn hosted equivalent is `POST /api/v1/events` with `{ "siteId": "WEBSITE_UUID", "event": { ... } }` and an `Idempotency-Key` header. Existing `/v1/outcomes` and `/v1/calls` routes remain supported.

| Canonical name | Confirmed source fact | Meta mapping | Google Ads mapping |
| --- | --- | --- | --- |
| `lead_received` | A form enquiry was accepted | `Lead` | Its configured action |
| `lead_qualified` | A form or answered call was explicitly qualified | `Lead` | Its configured action |
| `appointment_booked` | A booking was confirmed | `Schedule` | Its configured action |
| `estimate_sent` | An estimate was issued | No default delivery | Its configured action |
| `job_won` | An explicit won-job outcome | No default delivery | Its configured action |
| `payment_received` | A payment completed | `Purchase` with value | Its configured action with value |

Only `payment_received` sends monetary conversion value. Quotes and won jobs are not paid revenue. A missed or merely answered call is not automatically a qualified lead. `lead_qualified` requires `channel: "form"` or `channel: "call"`. Labels never select provider event names.

```json
{
  "name": "payment_received",
  "source": "crm",
  "externalId": "payment-123",
  "occurredAt": "2026-10-14T01:00:00Z",
  "sourceUpdatedAt": "2026-10-14T01:00:01Z",
  "visitorSessionId": null,
  "amountMinor": 125050,
  "currency": "USD"
}
```

This records a $1,250.50 payment without requesting any advertising delivery. Add the optional `meta` and/or `googleAds` envelopes only when this service owns delivery and permissioned matching data is available. See the Meta example in [Meta delivery](meta.md#send-eligible-outcomes-to-meta) and [Google Ads setup](google-ads.md). The endpoint determines `eventType`, `outcome` and qualification from the name; callers cannot override those meanings.

## Identity, matching and consent

Use one stable `externalId` for each distinct source fact and retain the original `occurredAt`. Advance `sourceUpdatedAt` for a correction. Replaying the same fact does not create a second delivery. A qualified update to an already sent lead is not a second copy of that lead; use separate facts only for genuinely distinct business milestones. Do not send the same payment from several sources. When another sender already owns a provider conversion, set that envelope's `deliveryOwner` to `external`.

Source attribution and provider matching are separate. Carry the accepted browser session into the enquiry, job and payment. A server-side matching envelope can contain permitted customer-provided email/phone hashes or platform click identifiers; it does not authorize joining an anonymous visitor to a customer. Paid or inferred identity data does not satisfy the `customer_provided` provenance requirement.

Normalize raw customer-provided values on your trusted server, before hashing:

```js
import { hashMatchingData } from './server/matching.mjs';
const metaMatching = hashMatchingData({ email: customer.email, phone: customer.e164Phone }, 'meta');
const googleMatching = hashMatchingData({ email: customer.email, phone: customer.e164Phone }, 'google_ads');
// Put these hash objects in their respective envelope's userData.
// Never put OAuth credentials, raw matching data or write tokens in the pixel.
```

Phone input must include the country prefix in E.164 form. Meta hashes digits without the plus sign; Google hashes the E.164 plus sign too. Google Gmail normalization is provider-specific. Do not reuse a phone digest between destinations. Hashing does not replace consent.

## Delivery behavior

Each destination has an independent durable queue, stable provider identity, bounded retries and safe receipts. Imports acknowledge stored facts, not advertising delivery. Provider responses do not prove a person matched, a conversion was attributed, or an ad caused revenue.

Corrections made before an attempt can update the queued event. After an attempt, changed payloads require review. The original payload and receipt remain; this release does not send retractions or conversion adjustments. Accepted and validation-only rows are terminal. Validated or accepted rows are not replayed as live conversions. Review any still-pending rows before enabling live mode; keep synthetic records in a separate QA database.

For browser/server copies of a Meta conversion, coordinate the same event name and ID. For Google, use the same transaction ID within the same action when another permitted source represents the same conversion. The safest default is one sender for each destination and business fact.
