# Agent-led installation

Start at README.md and package.json at the checked-out release. You are a coding/deployment agent; the kit's read-only MCP cannot provision infrastructure. Read docs/setup.md as the single acceptance checklist. Other guides are references for the selected route, not competing installation flows.

## First conversation

Use the owner's supplied context. Ask one grouped question only for missing facts: website/CMS and access, existing CRM or outcome source, desired managed versus self-hosted route, existing server resources, monthly budget and consent manager. Do not ask again for an answered decision.

Present these practical options before provisioning:

1. PipelineOn: recommended for least maintenance. No kit server or separate kit database. Explain its current plan and supported connectors from the actual account; do not invent a price or assume every CRM is connected.
2. Railway Docker plus persistent SQLite: simplest packaged self-hosting. Explain the current resource allowance/usage bill and ongoing backups.
3. Existing server/VPS Docker: control and potentially lower incremental cost, with more maintenance. An eligible free VM or limited free allowance may work, subject to capacity and uptime.

Cloudflare is optional for a pixel proxy or custom adapter; the unchanged kit does not run on Workers/D1. Do not require a website to move hosts, use Cloudflare DNS or purchase a new CRM. SQLite is already included. PostgreSQL/D1 ports are custom development, not supported deployment choices. Keep CRM, hosting, storage and advertising-account costs separate. Check sources in docs/hosting.md against the owner's currency and provider account before committing a budget.

## Implement the selected route

Record a short checklist and version. Inspect the website/form handlers, actual CRM schema, accepted business definitions, permissions and existing conversion senders. Reuse existing backend/workflow and valid authorizations. Request only missing owner decisions/access; provider UI security or new spending can still require the owner. This guide does not authorize spending or access to unrelated accounts.

For PipelineOn, copy the real site snippet and use its supported connection or website-scoped outcome API. Do not deploy a kit server as well. For self-hosting, provision the approved always-on Node/Docker service and persistent disk, run node server/setup.mjs --site WEBSITE_ORIGIN --url COLLECTOR_ORIGIN --name BUSINESS_NAME, and store .env privately. The setup command generates secrets but does not provision hosting. Configure the chosen host and HTTPS using docs/hosting.md; confirm /health and private endpoint authentication. Never overwrite an existing .env or database to redo setup.

Install the generated single script and connect consent/GPC handling using docs/pixel.md. Preserve the accepted session reference with the real enquiry. Map authoritative CRM/API/webhook/CSV events using docs/crm.md and docs/events.md; incomplete or unknown fields stay unknown. Keep credentials in server secret storage. Never put a write token in the pixel or a public worksheet.

Fingerprint evaluation is included in the consented pixel. Follow docs/browser-continuity.md: observe candidate evidence, never promote it to a verified person link. The matching rules are diagnostic, not calibrated probabilities. Keep advertising disabled until the source-to-outcome path works. When requested, configure one conversion sender and test Meta/Google separately using their guides.

When asked to connect Google or Facebook, start at [own-account ad setup](ad-accounts.md). Default to this business's own advertiser credentials, not a public multi-tenant OAuth product. Explain the private Google project/client and Meta dataset-token requirements before provisioning. Follow the linked provider steps through receipts, including Google's Testing-mode token expiry. Do not promise zero app objects or zero verification in every case. Public customer onboarding uses the separate platform requirements in that guide.

## Finish with proof

Follow docs/verify.md for one tagged consented visit, accepted enquiry, authoritative outcome with original timestamp/amount/currency, persisted report, replay, restart, consent withdrawal and mobile/desktop form checks. Test cookie reset and ambiguous fingerprints in an isolated QA site/database; no synthetic payments in live reports. A deployment or script load alone is incomplete.

Hand back: installed version, selected hosting/cost assumptions, protected credential locations (not values), pixel location, consent wiring, source mapping, exact observed receipts, maintenance/backup responsibilities and any missing verification. Mark unavailable steps as unavailable. Saving a destination, submitting an event, provider acceptance, ad matching and performance lift are separate results.
