# Connect Facebook through Meta Conversions API

Connect a dataset you are authorized to use, test a real server delivery, then enable new live outcomes. Saving a token only configures the destination; your connector must also request delivery on each eligible outcome.

## Connect your own dataset

For a business sending to its own dataset, use the direct Events Manager route. You do not need to develop a public Facebook Login application. Meta's [current direct-integration guide](https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started) describes creating the CAPI app/system user through Events Manager without App Review. An integration object may still exist behind the scenes; "no public app to build" does not mean "no app object anywhere."

1. In the owner's Events Manager, select the intended dataset/pixel and record its numeric ID. Use the same destination as any existing browser events that will be paired with this sender.
2. Open Settings, find Conversions API and its manual/direct integration option, then generate an access token. This control requires the business's developer privileges; if it is missing, resolve those privileges with the administrator rather than creating an unrelated public app.
3. Complete the documented Manage Integrations / Conversions API / Manage step when shown. Meta can create the associated app and system user automatically. Existing authorized app/system-user setups are an alternative, not a prerequisite for this route.
4. Store the token privately on the attribution server. Open the selected dataset's Test Events view and obtain its test code. Configure and verify the delivery as below.

Serving other advertisers through your own platform is a separate [platform integration](ad-accounts.md#building-a-multi-tenant-product). Account restrictions and required business access still apply to direct use.

## Collect the required access and data

| Item | Where it comes from |
| --- | --- |
| Authorized Meta business access | The business owner grants access to the intended dataset/pixel and advertising account as needed. |
| Dataset / pixel ID | The selected data source in Meta Events Manager. It is not an ad-account or campaign ID. |
| Conversions API access token | The dataset's server integration setup or an authorized system-user route. Store it only in hosting secrets or PipelineOn's secure connection form. |
| Test event code | The selected dataset's Test events screen. Use the code from the destination being tested. |
| Business outcome | A confirmed enquiry, booking, qualified call or collected payment from the trusted source. |
| Matching data and permission | Customer-provided normalized/hashed email or phone, or another supported matching field, with explicit advertising permission. UTMs/session references alone are insufficient. |
| Delivery owner and event ID | Inventory the browser pixel, HubSpot/other CRM, CallRail and any automation already sending the same conversion. |

Interface wording and available token options vary by account. Record the actual destination and access route. This repository does not supply Meta credentials or platform-partner approval. The remaining instructions apply to the kit; the explicitly labeled PipelineOn instructions are for the separate hosted product.

## Configure the destination

**Self-hosted kit:** add these settings to the private server environment. Use actual values, not the placeholders:

```dotenv
KIT_META_DATASET_ID=YOUR_NUMERIC_DATASET_ID
KIT_META_ACCESS_TOKEN=YOUR_PRIVATE_SERVER_TOKEN
KIT_META_MODE=test
KIT_META_TEST_EVENT_CODE=YOUR_TEST_CODE
```

Restart the service after editing. With Docker Compose, `docker compose up -d` recreates a service whose environment changed. The kit reads these at startup; changing a local file without updating the deployed service is insufficient.

**PipelineOn:** open Attribution for the intended website. In **Send outcomes to Meta**, choose **Set up connection** or **Manage connection**. Enter Dataset / pixel ID, Access token, **Test events** mode and Events Manager test code, then save. Use a separate QA website for synthetic payments so test values cannot pollute customer revenue reports.

## Send eligible outcomes to Meta

Add the following `meta` object to an outcome (or normalized call). Populate it from your permissioned first-party source. `examples/meta-payment.json` shows a complete synthetic example.

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

Supported mappings:

| Actual outcome | Meta event |
| --- | --- |
| Completed payment with amount/currency | `Purchase` |
| Completed booking | `Schedule` |
| Received/completed form | `Lead` |
| Completed call explicitly marked qualified | `Lead` |

The original event must be less than seven days old and not in the future. Website events need the source URL and actual browser user agent. Supported action sources also include `phone_call`, `physical_store`, `chat`, `email`, `system_generated` and `other`; use the actual origin of the conversion. An event imported through a CRM is not necessarily `system_generated`. Money converts from integer currency minor units, including currencies without two decimal places. Unsupported outcomes, missing matching data or incomplete website context receive visible stopped reasons.

## Test and enable live delivery

1. Start with a dedicated QA database/website and recent synthetic source records. Confirm visit linkage and exact revenue first.
2. Keep the intended dataset's Test events screen open. Import one eligible test outcome with its envelope. An import success proves storage only.
3. Inspect the kit's dashboard or authenticated `GET /v1/meta`; in PipelineOn use **Refresh delivery status** and **Delivery receipts**. Confirm an accepted receipt with the stable event ID and a corresponding Test Events entry.
4. Replay the exact import. Local revenue and logical conversions must not increase. Check denied consent and external ownership stop delivery as expected.
5. Promote the verified configuration to your production website/database, set live mode and clear the test code. Keep synthetic records in QA. If enabling an existing database, review all queued outcomes first: eligible records imported while paused or before configuration can be sent when delivery starts. Accepted test events are not replayed as live conversions.
6. Monitor stopped/failed delivery reasons. Fix credentials or mapping before retrying. Do not change timestamps or IDs to evade event-age or deduplication limits.

Acceptance by Meta is separate from matching a person or attributing an ad. Configure the intended conversion goal in the advertising account separately; uploading outcomes does not automatically change ad-set optimization.

When the result happens offline, preserve any original visit reference for local attribution. An unlinked in-person outcome can still have permitted customer-provided matching data; that does not create a missing website journey. See [offline and CRM recipes](crm.md#choose-the-connection-route).

## Deduplication, retries and corrections

- Pick **one server sender per logical conversion**. Use `deliveryOwner: "external"` when HubSpot, another connector or another sender owns it. This skips kit delivery. There is no universal API to ask whether an unrelated integration already sent a conversion.
- For browser + server copies, use `shared_event_id` and the same dataset, event name and event ID in both. For example, a browser `fbq('track', 'Purchase', {value: 1250.50, currency: 'USD'}, {eventID: 'invoice-123-purchase'})` must pair with that exact `eventId` here. Coordinate with the existing sender; neither the kit pixel nor this example installs an extra Meta pixel.
- Use `server_only` when this is the sole sender. An omitted event ID is generated deterministically from site, source, activity ID and event name. Never change an ID on retry. Cross-source collisions on the same destination/name/ID are blocked. This protects Meta delivery, but does not merge two imported payment facts in attribution reports.
- The outcome and queued delivery commit together. Before the network request, the worker persists the attempt and payload. Retries preserve that snapshot, event time and ID. Timeouts are uncertain delivery, so retrying uses the same deduplication identity.
- Network failures, rate limits and transient Meta errors retry with exponential backoff, honoring `Retry-After`, at most eight attempts. Retries stop before 46 hours from the first attempt or seven days from the original event, whichever is earlier. Expired jobs require review; they are never silently assigned a fresh time or ID. Permanent errors stop for operator action.
- A receipt is accepted only when Meta returns success and acknowledges one event. It stores HTTP status, safe error codes and trace ID, not raw provider messages, matching hashes or tokens. Accepted means provider receipt, **not** person matching, ad attribution or performance improvement.
- Corrections before the first attempt can update the conversion. After any attempt, a changed destination or conversion payload stops further sending for review. Accepted receipts are retained and marked when their source changes. Tombstones, consent withdrawal or choosing an external sender stop future attempts; they cannot recall an event already sent or in flight. Handle any required downstream correction/deletion with Meta separately.
- Pausing or token rotation takes effect after restart. A token rotation for the same destination can safely resume eligible retries; changing dataset, mode or test code after an attempt requires review. Back up the database to retain deduplication history. Restoring an old database can lose newer receipts, so reconcile before resuming.

The sender targets Graph API `v25.0` with a ten-second request timeout. Source reference: [Meta server event SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/server-event.js), [Meta request SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/event-request.js). Check current platform requirements when upgrading.

For kit operations, `GET /v1/meta` uses a read token. `POST /v1/meta/flush` and `POST /v1/meta/retry` require a write token; retry accepts `{ "id": "delivery-id" }`. The service normally processes pending jobs every five seconds.
