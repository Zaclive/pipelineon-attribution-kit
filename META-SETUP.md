# Connect Facebook through Meta Conversions API

Connect a dataset you are authorized to use, test a real server delivery, then enable new live outcomes. Saving a token only configures the destination; your connector must also request delivery on each eligible outcome.

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

In Events Manager, select the intended dataset, find its Conversions API/manual integration setup and obtain the server token using the available authorized route. Interface wording and available token options vary by account. If you cannot access them, the business administrator must grant the required access. Keep the [Meta setup reference](https://developers.facebook.com/docs/marketing-api/conversions-api/get-started/) with the deployment notes and check the current account's requirements. This repository does not supply Meta access or a partner approval.

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

## Add the outcome envelope

Use the [complete synthetic payment example](examples/meta-payment.json) and the [exact envelope contract](README.md#send-eligible-outcomes-to-meta). Replace IDs/times and session with your QA source evidence. Add `meta` to the standalone outcome or to the hosted event record inside its batch wrapper.

1. Set `deliveryOwner` to `self` only when this system owns the server conversion. Keep `external` when another sender owns it.
2. Set `consent` from actual permission, not inferred from a visit or a CRM status. Without permission, omit delivery or use `denied`.
3. Set `dataProvenance` to `customer_provided` only for identifiers collected from that customer through your permitted process. Do not forward purchased/enriched identities.
4. Use `server_only` deduplication for a sole sender. For a browser/server pair use `shared_event_id` with the exact same dataset, mapped Meta event name and event ID on both sides. Retain that ID across retries.
5. Set `actionSource` to where the conversion actually happened: for example `website`, `phone_call` or `physical_store`. A CRM update does not automatically mean `system_generated`.
6. Supply supported matching fields. Trim/lowercase email before SHA-256; normalize phone to digits including country code before hashing. Do not hash observed `fbp`/`fbc` or user agent. The kit does not automatically read Meta cookies.
7. Website events additionally need the actual conversion page URL and browser user agent. Keep the original event time; the kit rejects delivery outside its supported event-age window.

Completed payments map to `Purchase`, completed bookings to `Schedule`, received/completed forms to `Lead`, and completed explicitly qualified calls to `Lead` in v0.2. A won deal is not automatically collected money. Use the installed contract's mappings if a later version adds events.

There is no universal lookup that discovers conversions already sent by every other integration. Resolve ownership before sending. A duplicate CRM/payment-provider import can also double local revenue even if Meta deduplicates the advertising event.

## Test and enable live delivery

1. Start with a dedicated QA database/website and recent synthetic source records. Confirm visit linkage and exact revenue first.
2. Keep the intended dataset's Test events screen open. Import one eligible test outcome with its envelope. An import success proves storage only.
3. Inspect the kit's dashboard or authenticated `GET /v1/meta`; in PipelineOn use **Refresh delivery status** and **Delivery receipts**. Confirm an accepted receipt with the stable event ID and a corresponding Test Events entry.
4. Replay the exact import. Local revenue and logical conversions must not increase. Check denied consent and external ownership stop delivery as expected.
5. After the checks pass, change the destination to live mode and clear the test code. Restart the kit or save the hosted connection. Use genuine new outcomes; accepted test events are not replayed as live conversions.
6. Monitor stopped/failed delivery reasons. Fix credentials or mapping before retrying. Do not change timestamps or IDs to evade event-age or deduplication limits.

Acceptance by Meta is separate from matching a person or attributing an ad. Configure the intended conversion goal in the advertising account separately; uploading outcomes does not automatically change ad-set optimization.

When the result happens offline, preserve any original visit reference for local attribution. An unlinked in-person outcome can still have permitted customer-provided matching data; that does not create a missing website journey. See [offline and CRM recipes](SETUP-RECIPES.md#normalize-offline-activity-and-connect-your-crm).
