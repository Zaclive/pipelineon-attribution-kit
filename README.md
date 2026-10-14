# PipelineOn Open Attribution

An MIT-licensed kit that connects consented website visits to CRM outcomes and revenue, with optional server-side advertising delivery. Run it on your server or use [PipelineOn](https://app.pipelineon.com).

**[Start the setup](docs/setup.md)** or give your coding assistant [the installation task](docs/ai-setup.md).

## Choose the instructions you need

| Task | Guide |
| --- | --- |
| Server, free options, Docker, Railway or pixel Worker | [Hosting](docs/hosting.md) |
| Install the pixel and carry its reference into a form | [Pixel and events](docs/pixel.md) |
| Use Google Tag Manager | [GTM](docs/gtm.md) |
| Connect a CRM, API, CSV or offline activity | [CRM mapping and middleware](docs/crm.md) |
| Find a CRM's access route | [CRM access](docs/crm-access.md) |
| Connect website-pool calls | [CallRail](docs/callrail.md) |
| Name confirmed business milestones | [Business events](docs/events.md) |
| Configure Google Ads delivery | [Google Ads](docs/google-ads.md) |
| Configure Facebook delivery and deduplication | [Meta](docs/meta.md) |
| Request formats, reports and read-only assistant tools | [API reference](docs/api.md) |
| Check bots and ad-block observations | [Traffic checks](docs/traffic-checks.md) |
| Prove source, revenue and delivery before launch | [Verification](docs/verify.md) |

## What is in this repository

```text
docs/       Setup and reference guides
examples/   Copyable payloads, templates and integration examples
public/     Pixel, CallRail bridge and dashboard
core/       Validation, attribution and provider mapping
server/     HTTP API, SQLite storage and delivery workers
test/       Automated regression tests
```

Run one instance per website with Node.js 24.14.x and persistent SQLite storage. The included Docker configuration pins the runtime. The unchanged kit does not run as a Cloudflare Worker or stateless function. Use the documentation at your installed commit; check `package.json` before copying examples from another release.

The kit does not automatically connect arbitrary CRMs, discover every competing conversion sender or identify anonymous visitors as people. Your connector supplies authoritative outcomes and permitted matching data. A server receipt alone does not prove ad attribution.

## Licence and contributions

[MIT](LICENSE). You can use, modify and host the kit commercially. Hosting and external provider accounts may have their own costs.

Keep contributions synthetic: no credentials, personal/customer records, completed mapping worksheets or internal operating instructions. Copy templates into a private deployment repository. Run `pnpm test` from this directory before proposing executable changes.

<details>
<summary>Links from earlier versions of the README</summary>

## Canonical events and advertising destinations

Continue to [business events](docs/events.md) and [Google Ads](docs/google-ads.md).

## Set up your website and CRM

Continue to [Set up your website and CRM](docs/setup.md).

## Connect your data, using the route you choose

Continue to [Connect your data, using the route you choose](docs/crm.md#choose-the-connection-route).

### What your connector must carry

Continue to [What your connector must carry](docs/crm.md#map-the-contract-fields).

### Check that your connection is complete

Continue to [Check that your connection is complete](docs/verify.md).

### Send eligible outcomes to Meta

Continue to [Send eligible outcomes to Meta](docs/meta.md#send-eligible-outcomes-to-meta).

### Deduplication, retries and corrections

Continue to [Deduplication, retries and corrections](docs/meta.md#deduplication-retries-and-corrections).

## Run locally

Continue to [Run locally](docs/hosting.md#run-the-mit-kit-on-a-persistent-server).

## Install the pixel

Continue to [Install the pixel](docs/pixel.md#install-the-self-hosted-pixel).

## Import outcomes

Continue to [Import outcomes](docs/api.md#import-outcomes).

## Calls: CallRail, Ringba or your own system

Continue to [Calls: CallRail, Ringba or your own system](docs/api.md#calls-callrail-ringba-or-your-own-system).

## Reports, tracking doctor and assistant tools

Continue to [Reports, tracking doctor and assistant tools](docs/api.md#reports-tracking-doctor-and-assistant-tools).

## PipelineOn-hosted equivalent

Continue to [PipelineOn-hosted equivalent](docs/api.md#pipelineon-hosted-equivalent).

</details>
