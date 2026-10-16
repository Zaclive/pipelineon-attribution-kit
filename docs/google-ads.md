# Google Ads offline conversion delivery

This optional adapter sends consented business outcomes directly to Google's **Data Manager API**. It does not require server GTM. It supports Google Ads offline conversion actions; GA4, audiences, conversion adjustments and automatic campaign changes are not included.

## Prepare Google access

1. Use an existing Google Ads advertiser account and create an offline conversion action with type `UPLOAD_CLICKS` for each business milestone you want to measure. Its UI source is Website (Import from clicks). Record the numeric action ID and ten-digit account ID without hyphens. Map distinct stages to distinct actions.
2. Decide which actions should be primary for bidding in Google Ads. Do not count every step of one funnel as a primary result by default. This adapter does not change bidding settings.
3. Follow [Authorize your own Google account](#authorize-your-own-google-account) below. This kit currently uses a private OAuth client's ID/secret and an offline refresh token. The owner needs access to the advertiser, directly or through an authorized Ads manager account.
4. Keep credentials on the server. Complete any required account/customer-data terms through the owner's authorized process. There is no requirement to buy a third-party tracking app or deploy server GTM for this connector.

This uses the current Data Manager route. New integrations should not assume they can obtain classic Google Ads API `UploadClickConversions` access. See [Google's offline upload guidance](https://developers.google.com/google-ads/api/docs/conversions/upload-offline).

## Authorize your own Google account

A private Google Cloud project and OAuth client are still required for this kit's current user-token flow. They identify your own integration; creating them does not publish a customer-facing product. Do not start with the public multi-tenant onboarding process.

1. Select or create a Cloud project owned by the business. Enable **Data Manager API**. Follow [Google's access quickstart](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access); use its **Advertiser** access route. Do not apply as a Data Partner unless you actually need partner links.
2. Configure Google Auth Platform branding, audience and data access. Request `https://www.googleapis.com/auth/datamanager`. Choose **Internal** only for an eligible Workspace/Cloud Identity organization whose users stay inside that organization. Otherwise use **External**. During initial testing, add the owner's Google account as a test user.
3. Create a **Desktop app** OAuth client for this private bootstrap and download its client JSON to a private location outside the repository. The desktop flow returns to loopback; it needs no new public OAuth callback server. A web-app client is a different flow and needs its configured redirect URI.
4. On the owner's trusted computer, install/use Google's official Cloud CLI. Use an isolated private `CLOUDSDK_CONFIG` directory for this bootstrap so it does not replace credentials used by other local integrations. Run this single-line command, replacing the path. It uses the private client you just created and the scopes from Google's ADC quickstart:

```sh
gcloud auth application-default login --client-id-file="/PRIVATE/PATH/google-desktop-client.json" --scopes="https://www.googleapis.com/auth/datamanager,https://www.googleapis.com/auth/cloud-platform"
```

5. Complete the browser sign-in/consent with the intended Google user. Verify that this user has access to the exact Ads advertiser or its authorized parent manager. Cloud IAM access alone does not grant Google Ads access.
6. Read the generated ADC credential file privately from the location reported by `gcloud`. For its `authorized_user` credentials, map `client_id` to `KIT_GOOGLE_CLIENT_ID`, `client_secret` to `KIT_GOOGLE_CLIENT_SECRET`, and `refresh_token` to `KIT_GOOGLE_REFRESH_TOKEN`. Transfer values directly into the deployed service's secret configuration; do not print or paste the JSON/tokens into chat, logs or Git. Do not run a token-printing command just to prove setup. The kit does not automatically load ADC: it reads these environment variables and refreshes access tokens itself.
7. Keep `KIT_GOOGLE_MODE=validate`, configure the account/action IDs below, restart the deployed service, and prove authorization with an actual validation receipt. A successful OAuth login alone does not verify account/action access.

The Cloud CLI is a setup tool. The attribution server needs only its existing Node runtime and the configured refresh-token credentials; it does not need `gcloud` running to refresh access.

### Private use and token lifetime

Google documents verification exceptions for [eligible personal use and internal applications](https://support.google.com/cloud/answer/13464323?hl=en). Personal use is subject to the unverified warning and user cap; Internal requires an organization-owned project and an eligible audience. Neither exemption removes advertiser permissions or Google's policies.

For **External + Testing**, authorizations and offline refresh tokens expire after seven days for these scopes. Do not present this as a permanent unattended connection. For ongoing eligible private use, use the appropriate **In production** publishing status and reauthorize as needed; this status is an OAuth deployment setting, not an app-store listing or proof of verification. Determine the applicable exception or verification requirement from the actual account before launch. Tokens can still be revoked or expire for other reasons. See [Google's audience and token rules](https://support.google.com/cloud/answer/15549945?hl=en).

Google also supports service-account authentication, which has different verification rules. The shipped launcher currently accepts the OAuth client/refresh-token fields above; it does not accept a service-account JSON key, impersonated ADC or an attached service account as a drop-in configuration. Use a separately implemented/tested token provider if choosing that architecture. Do not claim the stock kit supports it automatically.

For customer-facing OAuth, follow [the multi-tenant boundary](ad-accounts.md#building-a-multi-tenant-product) and [Google's verification guide](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification). This own-account recipe is not a review exemption for a public service.

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
