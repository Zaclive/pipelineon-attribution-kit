# Individual use and multiple customers

Choose two things separately: **how many businesses/accounts you serve**, and **how many different CRM products supply outcomes**. One reusable CRM adapter can serve many customer connections. More CRM products require more adapters, even when they belong to one business.

This repository ships one website per server/database. The paths below describe what an installer or product builder must add; there is no `multiTenant=true` setting.

## Choose a path

| Situation | Reusable work | Work per connection | Application/hosting scope |
| --- | --- | --- | --- |
| One business, one CRM | One source adapter/workflow and the kit's existing destination workers | Authorize its account, map actual fields/stages, preserve the enquiry reference, choose destinations and verify | Stock kit, one isolated instance per website; operator read-token dashboard |
| One business, several CRMs/sources | One adapter per CRM/source product; shared canonical events and destination logic | Map each source account; decide which system owns each outcome, especially payments | May feed the same website instance when records belong to that site; no customer portal required merely because there are several CRMs |
| Several customers, the same CRM | Reuse that CRM adapter's authentication/API/normalization code | Separate account authorization, field/stage mappings, cursors, secrets, destinations and acceptance run for every customer | Separate kit instances, or build the multi-tenant product below |
| Several customers, different CRMs | Reuse the shared event contract and destination workers; implement each CRM adapter | Configure each customer connection and account's business meanings | Same customer-isolation/onboarding work, plus multiple provider integrations |

"Map once" means implement and verify the initial mapping for one account, then maintain it as its schema or business rules change. Even two accounts on the same CRM may use different custom-field IDs, pipelines, qualification rules or payment systems. Standard defaults can reduce setup; they do not replace account verification.

One customer may also have several accounts within the same CRM. Treat those as separate source connections. See [adapter versus connection configuration](offline-event-mapping.md#separate-adapter-code-from-connection-configuration).

## Install for one business

Follow [agent setup](ai-setup.md), [hosting](hosting.md), [pixel installation](pixel.md) and [source mapping](offline-event-mapping.md). The stock dashboard signs in with its read token; it has no customer signup, password recovery or organization membership model. An installer does not need to build those product features to operate its own isolated instance.

Optional ad delivery uses this business's own authorized destinations. Follow [own-account ad setup](ad-accounts.md): Meta's direct dataset-token route and the kit's supported Google private OAuth bootstrap. Account permissions and consent still apply. Installing open-source software does not supply provider credentials or approval.

## Operate separate instances for customers

You can reuse an adapter and deployment recipe while keeping each website's process/database, configuration, credentials and backup isolated. A central operator console is optional custom software; the stock kit does not supply one. Do not hand every customer the same dashboard token or put unrelated sites into one kit database.

This deployment shape is not an exemption from provider rules. A third-party service can still fall under platform/distribution requirements even when each customer has a dedicated server. Determine the authorization/review route from how you offer and connect the service, not simply from the number of databases. CRM commercial distribution requirements apply independently of Meta/Google access; see [CRM access](crm-access.md).

## Build a multi-tenant product

The following is a build sequence, not shipped functionality. One CRM serving many customers already needs this work if those customers share an application.

1. **Define the tenant and site boundary.** Introduce organizations, memberships/roles, website ownership and source connections. Choose separate databases or a tenant-aware storage design. Enforce the boundary for every API, job, cache, report, export and receipt; adding a `tenantId` field alone does not do this. Keep all components of the stock single-site server isolated unless deliberately replacing their contracts.
2. **Build application sign-in.** Add login/signup or invitations, account recovery, session protection and permission checks. An existing identity provider can supply authentication. Application login establishes which organization a person may administer; it does not authorize their CRM or advertising accounts.
3. **Build provider connection flows.** Add Connect CRM, Connect Meta and Connect Google where supported by the chosen authorization route. Bind OAuth state and callbacks to the signed-in operator and pending organization connection, use the provider's required CSRF/PKCE protections, and verify access to the selected source account/dataset/advertiser/action. Keep encrypted credentials, refresh/revocation state and reconnect/disconnect controls per connection. A manual private credential flow must be secure and permitted by that provider.
4. **Configure each customer's mapping.** Discover available fields/pipelines and store approved field IDs, business-stage definitions, currency/timezone, original-session relationship, source authority and destination actions. A reusable CRM adapter consumes this configuration. Require an account-specific sample and expected result before enabling imports.
5. **Isolate ingestion and delivery.** Resolve the tenant/source from trusted saved configuration and verified provider identity. Namespace source event IDs; maintain separate cursors, inboxes, retries, deduplication identities and destination credentials. Fence in-flight jobs on disconnect or destination change. The current launcher has one configured destination per provider; a shared multi-customer worker requires a deliberate refactor, not reused global environment variables.
6. **Complete provider access requirements.** Build a demonstrable connection/use flow and required public application/privacy/support materials. Complete the applicable Meta platform review/business verification and Google external OAuth verification before broad external onboarding. CRM review can be another independent requirement. Record what was submitted, approved and still restricted; an application login page or approved CRM connector does not approve ad delivery.
7. **Verify and operate each connection.** Prove source access, normalized events, original visit linkage, correct account/action delivery and replay/restart behavior. Also prove that one customer cannot read, overwrite or route work into another. Add connection health, credential expiry, failed-event repair, backups and disconnect/deletion procedures. [Verification](verify.md) covers the single-site evidence to preserve.

Do not treat the own-account Google desktop bootstrap as a customer-facing web OAuth callback. Google's [production delegation guide](https://developers.google.com/data-manager/api/devguides/concepts/deploy) describes per-user web authorization for external advertisers. Its [verification guide](https://developers.google.com/data-manager/api/devguides/concepts/oauth-verification) requires review for external user-credential apps, while documenting service-account/internal exceptions. The stock kit does not implement a service-account token provider. These Google sources were checked on 28 October 2026.

Meta's [platform setup](https://developers.facebook.com/documentation/ads-commerce/conversions-api/set-up-conversions-api-as-a-platform) and [direct setup](https://developers.facebook.com/documentation/ads-commerce/conversions-api/get-started) are different routes. Use [the ad-account guide](ad-accounts.md#building-a-multi-tenant-product) and recheck the current permissions/features and business-verification requirements for the actual integration before implementation. Do not generalize a private-owner exception to an external-customer service.

## Scope an implementation handoff

Record the selected path, businesses/sites, CRM products and accounts, required event types, deployment owner, customer-login needs, provider authorization/review state and the missing adapter work. Follow [architecture and status](architecture.md) for what already exists and [offline-event mapping](offline-event-mapping.md) for the source-to-destination contract. These decisions specify an implementation; they do not deploy one.
