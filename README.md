# PipelineOn Open Attribution

Connect consented website visits to enquiries, calls, jobs and payments. Includes browser fingerprint evaluation, matching evidence, attribution reports and optional Meta/Google conversion delivery. MIT licensed.

This kit is for a business operating its own attribution and ad-account connections, with one isolated server/database per website. Building a multi-tenant service for other businesses has additional application, permission and verification requirements; the hosted PipelineOn app handles its own platform onboarding.

## Set this up with your agent

Give a coding agent this repository URL and say:

> Read README.md and docs/ai-setup.md. Explain the hosting, database, CRM and cost choices, recommend a route, and ask me only for decisions or access you still need. Then set it up, install the single pixel, and verify one visit through a real business outcome. Keep advertising disabled until its separate test passes.

**Choose this first:** [PipelineOn](https://app.pipelineon.com) operates the service for you and is our recommendation for the least maintenance. Self-host this kit if you want control of the code, data and infrastructure. The agent should explain both routes before provisioning anything.

## What you need

| | PipelineOn | Self-hosted kit |
| --- | --- | --- |
| Website | Permission to add one script and connect tracking consent; WordPress and other hosts are supported | Same |
| Attribution server | Included in your PipelineOn service | One always-on Node.js 24.14.x process, or the included Docker image |
| Database | Operated by PipelineOn | Included SQLite database on a persistent disk; one instance per website |
| Public endpoint | Copy your website snippet from PipelineOn | An HTTPS server hostname; a provider hostname is enough, custom DNS is optional |
| Business outcomes | Supported connector or a trusted source adapter | Your existing backend, CRM API/webhook, workflow or CSV importer supplies outcomes |
| Operations | Managed service | You maintain uptime, backups, upgrades, secrets and the source adapter |

A CRM is a source of business facts, not the attribution server. Reuse your CRM; buying Pipedrive or another CRM is optional. Contacts or won deals alone do not establish completed payments. No paid identity service is required for fingerprint evaluation.

## Hosting and cost choices

Prices/allowances checked 15 October 2026. Provider bills, currency, eligibility and usage vary. [Detailed choices and sources](docs/hosting.md).

| Route | Starting cost | Setup and maintenance |
| --- | --- | --- |
| **PipelineOn: recommended managed route** | Current PipelineOn plan; confirm the offer in the app | Lowest infrastructure maintenance; install its snippet and connect your data |
| **Railway: simple self-hosting** | Hobby starts at USD 5/month including USD 5 resource usage; overages extra | Deploy Docker, attach a persistent volume and configure backups |
| **Existing server/VPS with Docker** | No incremental server subscription if capacity is already paid for | More control; you handle HTTPS, uptime, updates and backups |
| **Railway Free or eligible free VM** | Limited free allowances; not guaranteed free production | Confirm capacity and always-on availability; more limits or maintenance |
| **Cloudflare Worker: optional add-on** | Free allowance; paid Workers starts at USD 5/month | Can proxy this pixel or run a custom adapter. The complete kit still needs its Node/SQLite server |

SQLite needs no separate database subscription. D1 and hosted PostgreSQL are different architectures and require a storage port; they are not configuration switches in this release. Never replace the persistent disk with ephemeral storage. See [hosting](docs/hosting.md).

## Self-host: configure, start, install

After choosing and authorizing a server, clone this repository or extract a tagged release. The following command creates a private .env with separate random tokens and prints your one-script snippet. It does not create hosting or overwrite existing configuration.

```sh
node server/setup.mjs --site https://www.example.com --url https://your-collector.example.com --name "Your business"
docker compose up --build -d
```

Docker publishes on localhost:4310 for an HTTPS reverse proxy. A managed container host uses its public HTTPS endpoint, HOST=0.0.0.0 and a persistent volume. If using Node directly, run node --env-file-if-exists=.env server/start.mjs with Node.js 24.14.x (pnpm start is an optional shortcut). No package dependencies or package manager need installation. With Docker only, use the configuration recipe in docs/hosting.md. Follow the selected [hosting recipe](docs/hosting.md) before exposing it.

Install the generated script on the website. Wire consent once through window.OpenAttribution.sites[SITE_ID].consent(true); use consent(false) on withdrawal. Tracking is off by default and respects Global Privacy Control. Your site's domain does not have to use Cloudflare. [Pixel instructions](docs/pixel.md).

Open your collector origin in a browser (for example, `https://your-collector.example.com/`). Sign in using `KIT_READ_TOKEN` from your private `.env` or hosting secrets, without its surrounding quotes. The write token belongs only on trusted servers. The dashboard begins empty until you collect a consented visit and import an outcome.

For a free local trial, follow [the Node-only local recipe](docs/hosting.md#try-it-locally-with-node). It uses HTTP loopback and needs neither Docker nor a package manager. Local success does not provide public hosting or connect a real CRM.

Then follow [the setup checklist](docs/setup.md): preserve the accepted visitorSessionId with an enquiry, import an authoritative outcome, inspect its attribution, restart and replay it. A running pixel is the start of setup, not its completion.

## Connect your own Google and Facebook accounts

Give your agent this follow-up:

> Read docs/ad-accounts.md and the Google/Meta guides it links. Connect this business's own ad accounts for conversion delivery. Use the direct advertiser setup, explain the required private credentials, configure Meta Test Events and Google validate mode, and verify provider receipts before any authorized live delivery. Keep the one-script install. Ask only for missing account access or decisions.

For Meta, start with the dataset's Events Manager token route; you do not build a public login app. Google still needs a private Cloud project and OAuth client for this kit's current authentication. Eligible personal/internal use can avoid public OAuth verification, with the limits explained in [own-account setup](docs/ad-accounts.md). This connects confirmed conversions; campaign creation, ad-spend reporting and bidding automation are separate integrations.

## What is included, and where to go next

| Task | Guide |
| --- | --- |
| Agent instructions and setup decisions | [Agent setup](docs/ai-setup.md) |
| Hosting, free plans, persistent storage and backups | [Hosting](docs/hosting.md) |
| Pixel, consent, SPA/hash routes and form references | [Pixel](docs/pixel.md) |
| Browser fingerprints and possible-return evidence | [Browser continuity](docs/browser-continuity.md) |
| CRM, API, CSV and offline outcome mapping | [CRM mapping](docs/crm.md) and [access options](docs/crm-access.md) |
| Verified people and several browser histories | [People](docs/people.md) and [HubSpot mapping](docs/hubspot-attribution.md) |
| Calls, qualification and payments | [CallRail](docs/callrail.md) and [business events](docs/events.md) |
| Own-account conversion feedback and multi-tenant boundaries | [Ad-account setup](docs/ad-accounts.md), [Meta](docs/meta.md) and [Google Ads](docs/google-ads.md) |
| Reports, evidence and read-only MCP tools | [API](docs/api.md) |
| Terminology and defensible claims | [Tracking jargon](docs/tracking-jargon.md) and [capabilities and limits](docs/capabilities.md) |
| Prove the full installation | [Verification](docs/verify.md) |

## Boundaries

Fingerprints are possible browser connections, not verified people. This release evaluates candidates without merging histories, changing campaign credit or delivering inferred identities to advertising platforms. Source attribution is not proof an ad caused a sale; provider acceptance is not proof of ad matching or better ROI. The kit does not include universal CRM OAuth, anonymous-person identity data, automatic bidding or predictive LTV.

Keep docs and code at the same release. Directory map: docs for instructions, examples for templates, public for pixel/dashboard, core for contracts/matching, server for SQLite/API/queues, test for regression tests. Run pnpm test before contributing. Keep credentials, customer records and completed worksheets private. [MIT licence](LICENSE).
