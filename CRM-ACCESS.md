# CRM access options

Checked 14 October 2026. These are customer-authorized connection options, not a list of native connectors included in this MIT kit. API availability, account plan and permission to distribute a commercial app are separate questions. A private API route does not automatically remove a provider's distribution rules.

## Practical starting points

| System | Route for a customer's own connection | Restriction to plan for |
| --- | --- | --- |
| JobNimbus | Customer creates an API key with an Access Profile. | Copy the full key, not its display ID. New keys expire after a year; rotate before expiry. [Key setup](https://support.jobnimbus.com/how-do-i-create-an-api-key). |
| HighLevel / GoHighLevel | Scoped Private Integration Token for an individual account, using API v2. | Public/multi-account integrations and native webhooks follow the OAuth path; basic versus advanced API access depends on plan. [Private tokens](https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/index.html), [authorization choice](https://marketplace.gohighlevel.com/docs/2023-02-21/Authorization/authorization_doc/index.html), [plan access](https://help.gohighlevel.com/support/solutions/articles/48001060529-highlevel-api). |
| Housecall Pro | Eligible customer generates an API key for a custom connection. | API access requires MAX. [API overview](https://help.housecallpro.com/en/articles/8505035-api-overview). |
| Workiz | Customer API token and secret; read the current developer contract. | Open API is listed under Ultimate. Workiz and HighLevel are separate products. [Developer portal](https://www.workiz.com/developers/), [plans](https://www.workiz.com/pricing-plans/). |
| Service Fusion | Customer-authorized Open API connection. | API requires Pro; use the documented token flow. [Access](https://servicefusion.zendesk.com/hc/en-us/articles/360035145811-Open-API-Integration-Getting-Started), [API](https://docs.servicefusion.com/). |
| AccuLynx | Admin-issued API key for the appropriate integration and location. | Enable AppConnections; verify the account's commercial terms and required endpoint access. [Authentication](https://apidocs.acculynx.com/docs/authentication), [AppConnections](https://acculynx.com/appconnections/). |
| ServiceM8 | API key for the customer's own private integration or a single specific customer. | The private route excludes broad promotion. Public add-ons use the development-partner/OAuth route; some features including webhooks require it. [Authentication](https://developer.servicem8.com/docs/authentication). |
| Jobber | OAuth/GraphQL app, including controlled draft use. | Draft apps are limited to five paying non-tester accounts; wider distribution needs review. Coordinate testing within Jobber's rules. [Custom integrations](https://developer.getjobber.com/docs/custom_integrations/), [testing](https://developer.getjobber.com/docs/building_your_app/testing_your_app/). |
| Pipedrive | API/OAuth access exists for permitted private use. | Commercial distribution approval rules also apply outside the Marketplace. Do not treat customer keys as a bypass. [Developer agreement](https://www.pipedrive.com/en/developer-agreement). |
| FieldEdge | Customer/private access and partner applications have distinct routes. | Partner apps require onboarding, sandbox validation and approval. [Developer portal](https://docs-dev.fieldedge.com/), [partner authentication](https://docs-dev.fieldedge.com/dev/partner-authentication-guide-1981952m0). |
| ServiceTitan | Official customer/partner integration process. | Third parties cannot bypass review by asking a customer to register an app for them. [Developer FAQ](https://developer.servicetitan.io/docs/faqs/developers), [customer FAQ](https://developer.servicetitan.io/docs/faqs-customers). |

HubSpot users can use their existing authorized connection or a permitted customer-owned integration. PipelineOn has a native HubSpot connection; the MIT kit does not include its OAuth implementation. Regardless of the CRM, a customer/contact mirror must still supply normalized bookings, qualification and payment facts through the [outcome API](INTEGRATIONS.md). Do not assume connecting contacts completes revenue feedback.

CallRail is a call-data source, not a replacement for the CRM. Its customer-key and webhook route is covered in the [CallRail guide](CALLRAIL.md).

## HighLevel connection recipe

For a customer-owned single-account setup, create a scoped Private Integration Token and save it in the adapter's credential store with the intended location ID. Read contacts, opportunity transitions and actual payment records only as needed. Keep the enquiry's accepted `visitorSessionId` with the relevant record. Use API polling first if native webhooks are unavailable under the selected authorization route. Do not present a private-token pilot as approval for an unlimited public connector.

Normalize each genuine activity into the shared outcome contract. A won opportunity is useful pipeline evidence; only actual completed payments enter revenue. Store pagination/cursors, unchanged retry payloads and token-expiry failures. Then run the middleware guide's full acceptance checklist. This recipe specifies a connection to build; it is not a preconfigured HighLevel workflow in the bundle.

## JobNimbus connection recipe

Create a restricted Access Profile and a dedicated API key, record its expiry and store it only on the adapter server. Read the relevant contacts/jobs, status changes and supported payment data. First prove that the account's API exposes the authoritative activity IDs, timestamps and collected amounts needed. If only job value is available, launch lead/booking attribution and obtain payments through an accounting feed rather than relabeling job value as collected revenue.

Carry the enquiry reference into the job's related outcomes, normalize to the same contract, and use a durable update cursor or authenticated event route. The Meta sender remains shared with every other adapter. Endpoint-specific mappings and a live customer acceptance run still need implementation.

## What an API-based offer can promise

“Connect your website tracking and supported CRM or call data to one outcome API, then send eligible conversions to Meta with delivery receipts.”

Name a provider as ready only after testing its source authentication, permissions, field mapping, session linkage, retries and real destination. Keep “customer-owned custom integration,” “hosted connector” and “approved marketplace app” distinct. Middleware cannot remove a CRM's paid API entitlement or commercial distribution requirements.
