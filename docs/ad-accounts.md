# Connect this business's own ad accounts

Use this as the agent's entry point for optional Google Ads and Facebook/Instagram conversion delivery. The kit runs for one business, with one isolated instance/database per website. Reuse the installed consented script and the trusted source adapter. Credentials and conversion delivery live on the server.

Choose [the deployment model](deployment-models.md) first. Several customers using the same CRM still need separate source/ad connections and account mappings. Several CRMs inside one business do not, by themselves, require a customer login portal. [Offline-event mapping](offline-event-mapping.md) explains how each source feeds the shared destination workers.

Here, connecting ads means sending confirmed business outcomes back to an advertiser's account. The kit does not create campaigns, retrieve ad spend, operate budgets or promise better bidding. A source-tagged visit alone is not an eligible conversion or sufficient customer matching data.

## Choose the correct access route

| | Own-account kit: default | A public service connecting other businesses |
| --- | --- | --- |
| Meta | Own dataset/pixel, Events Manager CAPI token and Test Events code. Meta can create the integration app/system user as part of this route; no custom public login or App Review is needed for that direct setup. | Platform-owned Meta app, advertiser authorization and the review/access requirements for the chosen platform integration. |
| Google | Own Cloud project, Data Manager API enabled, private OAuth client and the owner's refresh token. Eligible personal/internal use has verification exceptions; account authorization still applies. | External OAuth onboarding, appropriate verification, secure per-customer token storage and explicit access to each advertiser. |
| Deployment | Included Node/SQLite server and private environment. One instance per website. | Tenant authorization, isolated destinations/data/queues, credential lifecycle and operational controls must be built. |

Provider requirements checked 16 October 2026. Start from [Meta's direct guide](https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started), [Google API access](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access) and [Google's verification exceptions](https://support.google.com/cloud/answer/13464323?hl=en). Private use does not mean no credentials, no consent or guaranteed access to every account.

## Agent setup order

1. Use the owner's context. Confirm the business owns the destinations, which providers are requested, the exact dataset/advertiser/action IDs, the existing server and outcome source, and any current conversion senders. Ask one grouped question for missing facts. If this serves unrelated customers, use the platform boundary below rather than claiming an owner-only exception.
2. Prove the visit-to-outcome path using [setup](setup.md). Record a stable source ID, original time, exact payment amount/currency, and permissioned matching data. Pick one server sender per conversion; coordinate any existing browser sender's deduplication ID.
3. Follow [Meta](meta.md#connect-your-own-dataset) for the dataset token and test code. Follow [Google](google-ads.md#authorize-your-own-google-account) for private OAuth and action mapping. Transfer secrets directly to private server configuration; keep tokens and downloaded credential JSON out of chat, logs, HTML and Git.
4. Restart the actual deployed service. Start Meta in `test` and Google in `validate`. Import a separate eligible QA outcome with its documented provider envelope; configuring credentials alone does not request a send. Keep synthetic records in a separate database/site.
5. Read the durable receipts. Meta needs an accepted receipt and the corresponding Events Manager Test Events entry. Google validation is a configuration check; live ingestion later requires the same request to reach `SUCCESS`. Record the account/action/event/request IDs and actual status, not secret values. Replay must not create another logical conversion.
6. Enable new live outcomes when the owner's request authorizes production delivery and the tests pass. Otherwise leave test/validate mode in place and state what remains. Review unattempted queued records first. Keep receipts through restart and backups; monitor credential expiry/revocation and provider errors.

Owner sign-in, consent, missing privileges or provider review can require owner action. Prepare everything else and report the exact remaining step. Do not substitute a shared kit author's app/token or claim an unobserved provider result.

## Building a multi-tenant product

The hosted PipelineOn application has a different onboarding and security surface. Turning this standalone kit into a service for other businesses requires additional work:

Follow [the multi-tenant build sequence](deployment-models.md#build-a-multi-tenant-product). Application login establishes organization membership; Connect CRM/Meta/Google establishes provider authorization; provider review establishes the approved access/distribution scope. These are separate steps. The stock read-token dashboard implements neither customer onboarding nor provider OAuth callbacks. Separate customer instances also do not automatically exempt a third-party service from platform requirements.

- **Meta:** follow [Conversions API as a Platform](https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform). Its documented route requires a Meta app and App Review for the specified permissions/features. Complete the business verification and access steps required by the selected route. Owner-generated CAPI tokens are not blanket approval for a public platform.
- **Google:** implement customer OAuth delegation and the applicable [Data Manager OAuth verification](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification). An organization-internal or personal-use exception does not cover arbitrary advertiser customers. Data Partner approval is a separate requirement when choosing a partner-link architecture; ordinary authorized advertiser access is a different route.
- **Your service:** implement tenant-scoped authorization, encrypted credential storage, safe OAuth callbacks, revocation/deletion, isolated destinations and delivery receipts, privacy/support materials and monitoring. Changing a site ID in one kit database does not add tenant isolation.

See [Google's production delegation guidance](https://developers.google.com/data-manager/api/devguides/concepts/deploy). If you later add campaign management or spend reporting, check those APIs' own project/app access requirements; the conversion-delivery credentials are not a general ads-management integration.
