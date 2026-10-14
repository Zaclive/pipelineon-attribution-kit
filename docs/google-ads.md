# Google Ads offline conversion delivery

This optional adapter sends consented business outcomes directly to Google's **Data Manager API**. It does not require server GTM. It supports Google Ads offline conversion actions; GA4, audiences, conversion adjustments and automatic campaign changes are not included.

## Prepare Google access

1. Use an existing Google Ads advertiser account and create an offline conversion action with type `UPLOAD_CLICKS` for each business milestone you want to measure. Its UI source is Website (Import from clicks). Record the numeric action ID and ten-digit account ID without hyphens. Map distinct stages to distinct actions.
2. Decide which actions should be primary for bidding in Google Ads. Do not count every step of one funnel as a primary result by default. This adapter does not change bidding settings.
3. In a Google Cloud project, enable the Data Manager API and configure an OAuth client. Authorize `https://www.googleapis.com/auth/datamanager` using a Google user with access to the advertiser account, and obtain an offline refresh token through your secure OAuth flow. Public OAuth applications may require Google's verification. Follow [Google's access guide](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access).
4. Keep the client secret and refresh token on the server. Do not put them in chat, website HTML, analytics tags or source control. Complete any Google account and customer-data terms yourself when Google requests agreement.

This uses the current Data Manager route. New integrations should not assume they can obtain classic Google Ads API `UploadClickConversions` access. See [Google's offline upload guidance](https://developers.google.com/google-ads/api/docs/conversions/upload-offline).

## Configure the standalone server

```dotenv
KIT_GOOGLE_MODE=validate
KIT_GOOGLE_ACCOUNT_ID=1234567890
KIT_GOOGLE_LOGIN_ACCOUNT_ID=
KIT_GOOGLE_CONVERSION_ACTIONS={"lead_received":"111111111","payment_received":"222222222"}
KIT_GOOGLE_CLIENT_ID=YOUR_OAUTH_CLIENT_ID
KIT_GOOGLE_CLIENT_SECRET=YOUR_SERVER_ONLY_SECRET
KIT_GOOGLE_REFRESH_TOKEN=YOUR_SERVER_ONLY_REFRESH_TOKEN
```

The IDs above are illustrative. Set a manager/login account only when that account provides the authorized access path. Restart the kit after configuration changes. In the hosted app, use Attribution → Send outcomes to Google Ads. Provider credentials belong only in the secure server configuration.

## Request a conversion

Add this envelope to a real canonical event or existing outcome import:

```json
{
  "googleAds": {
    "version": 1,
    "deliveryOwner": "self",
    "dataProvenance": "customer_provided",
    "consent": { "adUserData": "granted", "adPersonalization": "denied" },
    "eventSource": "PHONE",
    "transactionId": "payment-123",
    "adIdentifiers": { "gclid": "PERMISSIONED_ORIGINAL_CLICK_ID" }
  }
}
```

Use the actual consent choices and source: `WEB`, `APP`, `IN_STORE`, `PHONE`, `MESSAGE` or `OTHER`. This kit requires granted ad-user-data consent for delivery. Ad personalization may remain denied. An event needs at least one supported click identifier (`gclid`, `gbraid`, `wbraid`) or a permitted customer-provided email/phone hash in `userData`. Preserve original identifiers from the customer's journey. Do not manufacture click IDs or use the illustrative ID above for a real delivery.

For email/phone matching, use the server helper documented in [business events](events.md). The adapter encodes SHA-256 hashes as HEX. No raw email or phone fields are accepted by this envelope. Each event retains its actual timestamp and stable transaction ID. This kit conservatively limits source age to 28 days and retries to eight submissions within 46 hours. These are kit limits, not a claim about every Google account's maximum window.

## Validate, then send new live outcomes

1. Start with `validate`. Use synthetic, permissioned test input and inspect the result in the dashboard or `GET /v1/google`. `POST /v1/google/flush` runs the worker immediately with the server write token; it also runs periodically when enabled.
2. `Validated only` means Google checked the request. It is not a live conversion, a matching test or proof of attribution. Validate-mode rows are not replayed when switching modes.
3. After checking the account, action, consent and mapping, promote the verified configuration to the production database and set mode to `live` for new business facts. Keep synthetic records in QA; review unattempted pending rows before enabling live mode on an existing database. A returned request ID means **submitted**. The queue subsequently polls Google's processing result and shows **Google processed** only after the matching destination reports `SUCCESS`.
4. Review failed or partial processing results in the receipts. Once a request ID exists, retries only check that request's status. They do not submit the conversion again. Up to 120 processing checks are retained. Unknown, changed or exhausted results require review.

Safe status responses exclude credentials and matching payloads. Provider error text is not stored because it can echo private data. `POST /v1/google/retry` with `{ "id": "DELIVERY_ID" }` can retry eligible failed/blocked jobs after fixing setup; terminal or uncertain historical rows are protected against unsafe replay.

Google processing confirms ingestion status. Check the Google Ads account's diagnostics for matching and attribution separately. Follow [Google's event guide](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events). This release's automated tests simulate provider responses; a real account validation receipt must be checked in your environment before claiming a verified connection.
