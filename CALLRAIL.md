# Connect CallRail calls to visits and Meta

The kit includes a verified webhook receiver, a durable API-refresh queue, a consent-aware cookie bridge and call receipts. PipelineOn uses the same provider mapper and worker, with encrypted credentials and a settings screen at **Settings > Integrations > CallRail**. A real CallRail account and website-pool call still need to be validated before claiming a customer installation is complete.

```text
Consented tagged visit -> accepted pixel session -> bridge cookies
                                                   |
CallRail website number pool -> Custom Cookie Capture -> signed webhook
                                                   |
                                durable queue -> authenticated call API read
                                                   |
                            normalized call -> attribution + Meta outbox
                                                   |
                         qualified, consented inbound call -> Lead receipt

CRM / payment API -> actual payment + enquiry reference -> Purchase receipt
```

## What the customer needs

- The pixel installed on the intended website, with an accepted session.
- A CallRail account, company, authorized API key, company Webhooks signing key and website number pool.
- A public HTTPS receiver and durable storage, supplied by PipelineOn or your self-hosted kit.
- A consent manager that controls the pixel, bridge and CallRail tracking together.
- A configured Meta destination if PipelineOn/the kit will own advertising delivery.

CallRail's [API](https://apidocs.callrail.com/) uses customer API keys. The account ID in the API URL and the company ID are distinct. [Custom Cookie Capture](https://support.callrail.com/hc/en-us/articles/5711577152909-Custom-Cookie-Capture) is for website number pools. Static numbers and calls placed directly from ads may not have a browser match. Confirm access and number capacity in the customer's CallRail subscription.

## 1. Configure the receiver

### PipelineOn

1. Open Settings > Integrations > CallRail and select the website.
2. Enter the account ID, company ID, API key and Webhooks signing key. The save verifies company API access. Secrets are encrypted on the server and are never returned to the browser.
3. Keep **Attribution only** selected while testing. Choose **PipelineOn sends** only after resolving any existing CallRail/CRM Meta sender.
4. Copy the generated webhook URL and the two cookie names. Add the URL to both **Post-Call** and **Call Modified** in the company's CallRail Webhooks integration. Preserve other destinations.
5. Configure Custom Cookie Capture for both names and install the browser bridge below.

One connection belongs to one website and company. Account/company IDs are locked after creation to avoid reassigning queued calls to another business. Pause stops provider refreshes; it does not retract imported facts or already-requested Meta events. Manage the Meta destination separately to pause advertising delivery.



### Self-hosted kit

Set these on the server, never on the website:

```dotenv
KIT_CALLRAIL_ACCOUNT_ID=your_account_id
KIT_CALLRAIL_COMPANY_ID=your_company_id
KIT_CALLRAIL_API_KEY=your_private_api_key
KIT_CALLRAIL_SIGNING_KEY=your_company_webhook_signing_key
KIT_CALLRAIL_COOKIE_NAME=oa_callrail_main
KIT_CALLRAIL_META_OWNER=external
```

Restart the kit. Add `https://your-kit.example/webhooks/callrail` to Post-Call and Call Modified. Capture `oa_callrail_main` and `oa_callrail_main_ads`. `external` records attribution without sending conversions; `self` lets the existing Meta queue assess eligible events. Meta still needs its own destination configuration.

Use the persistent database volume from the README. The worker checks for queued calls every five seconds and does no CallRail API polling when the queue is empty. Do not run overlapping kit processes with different configurations against one SQLite database.

## 2. Install the consent-aware session bridge

The public script is `/callrail.js` on either PipelineOn or the kit. Load it after the relevant pixel. It writes **only** an accepted session UUID into a host-only cookie with `Path=/`, `SameSite=Lax`, `Secure` on HTTPS and a 30-minute lifetime refreshed while permitted tracking is active. It writes a paired `_ads` cookie only when advertising permission is explicit. No raw contact data, credentials or UTMs go into these cookies.

PipelineOn's settings screen supplies the actual public tracking tag. For the kit, use its site ID:

```html
<script src="https://your-kit.example/callrail.js"></script>
<script>
PipelineOnCallRail.configure({
  kind: "kit", // "pipelineon" for the hosted pixel
  key: "your-website", // hosted public tracking tag, or kit site ID
  cookieName: "oa_callrail_main",
  trackingConsent: false,
  advertisingConsent: false
});
</script>
```

Connect your consent manager to:

```javascript
PipelineOnCallRail.consent("oa_callrail_main", trackingAllowed, advertisingAllowed);
const bridge = PipelineOnCallRail.refresh("oa_callrail_main");
if (bridge.ready) {
  // Your consent manager may now start the already-configured CallRail tracker.
}
```

A pixel readiness event does not grant permission. Call the consent method on every change; withdrawal must also disable the relevant trackers. The bridge clears cookies on withdrawal, missing context, GPC or context-access errors. Check readiness after the pixel accepts the visit, before CallRail creates its visitor session. Merely ordering asynchronous script tags is insufficient. Configure separate names for separate tracked websites; both scripts must run in the website's first-party context.

Verify the **actual CallRail API record** contains both captured values. Existing cached CallRail visitor data can predate a consent change; this bridge does not retroactively erase provider-held data or retract a conversion already accepted by Meta. Use the providers' data/consent controls when that is required.

## 3. What gets normalized

| CallRail evidence | Normalized meaning |
| --- | --- |
| Company ID + call ID | Stable source record identity, independent of retries. |
| `start_time` | Original call time, preserved through corrections. |
| `answered=true` | Completed call, not automatic qualification. |
| `lead_status=good_lead` | Explicitly qualified call. |
| `not_a_lead` | Unqualified. |
| `previously_marked_good_lead`, null or unrecognized status | Unknown for this call; no new Lead inferred from an earlier call. |
| Captured visitor cookie | Session reference, accepted only within the connected website. |
| Paired advertising cookie with the same reference | Advertising permission captured for the call. Missing/mismatched values deny delivery. |
| Real caller phone in E.164 | Server-side SHA-256 matching hash, only with advertising permission. Never the tracking number. |
| Call value, duration, transcript or recording | Not imported as revenue or stored by this connector. |

The raw webhook is verified using CallRail's HMAC-SHA1/base64 `Signature` over the original bytes. Only its call reference and digest enter the durable queue. The worker re-reads the current call through the authenticated API, so an older webhook's contents cannot overwrite a correction. Different company/call IDs fail validation. An unchanged normalized snapshot keeps its prior source revision; changed facts receive a durable later revision.

The source is `calls-callrail` in PipelineOn and `callrail` in the kit. Both use `companyId:callId` as the external record ID. Do not also import these same calls through another adapter/source.

## 4. Meta ownership, retries and receipts

A completed, explicitly qualified **inbound** call can become a `Lead` with `action_source=phone_call`. Sending requires `self` ownership, captured advertising permission, usable matching data and an enabled Meta destination. Start that destination in test mode. A click-to-call button and a qualified phone enquiry are different facts; decide which conversion your campaigns use.

The connector supplies a stable opaque event ID derived from company, call and event name. It does not query Meta to discover every other sender. Disable another server sender for the same conversion, or implement coordinated event IDs through the generic outcome API. This native connector defaults to attribution only.

CallRail refreshes retry transport errors, throttling and provider 5xx responses, up to eight attempts, with exponential backoff and bounded `Retry-After`. Access and malformed-data errors stay failed for inspection. Durable leases recover interrupted workers; stale leases and changed configurations cannot overwrite newer imports. Hosted import quotas and membership checks still apply. Call import, Meta capture and call receipt commit together.

A newer call version from another importer raises `CALLRAIL_IMPORT_CONFLICT` instead of reporting a successful import. Resolve the duplicate adapter before retrying.

The dashboard shows the latest 50 call receipts. **Imported with a website session** means the call reference matched the connected site's session; inspect attribution for the actual source evidence. It does not mean Meta received or matched the event. Check the separate Meta receipt and Test Events. API acceptance does not promise advertising attribution or campaign performance.

To recover a missing webhook, enter the CallRail call ID in PipelineOn's **Queue refresh** field. On the kit, send `POST /v1/callrail/retry` with a server-side write token and `{"callId":"CAL123"}`. To retry an existing kit receipt, use `{"id":"receipt-uuid"}`. Read-only tokens cannot trigger imports or sends. Operators can also use `POST /v1/callrail/flush`; ordinary scheduled operation needs neither manual endpoint.

Import real collected revenue separately from the authoritative CRM/payment system, with a stable payment ID, exact amount/currency and the same enquiry/session reference. Calls never invent purchases.

## Test before offering it to customers

| Scenario | Required result |
| --- | --- |
| Tagged visit, accepted session, website-pool call | Actual captured cookie joins the call to the same website visit. |
| Call later becomes qualified | One call updates and one eligible Lead is queued. |
| Exact replay or worker restart | No extra call or conversion. |
| Old webhook after correction | Authenticated current API state wins. |
| Forged signature or wrong company | Rejected before ingestion. |
| Different site's session UUID | Recorded unlinked; advertising matching data removed. |
| Missing cookies, static number or direct-from-ad call | No guessed website attribution. |
| Consent withdrawal, GPC or blocked cookies | Bridge clears/stays unavailable; no inferred advertising permission. |
| Other Meta sender still enabled | Leave this connector on attribution only. |
| Paused connection, removed member, rate limit or API outage | Fenced import, visible receipt and appropriate bounded recovery. |
| Actual payment arrives later | Separate payment fact preserves source, exact amount and currency. |

Automated tests exercise synthetic CallRail responses and Meta-shaped receipts. A live account test must still prove website number swapping, captured cookies, real webhook signatures, qualification updates and the target Meta test receipt. Do not describe a specific customer as fully connected until those checks pass.
