# Agent entry point

This is an MIT self-hosted attribution baseline. The repository supplies the pixel, server, SQLite storage, event contracts, reports and optional conversion delivery. An installation still needs hosting, website access and a source adapter. Read the checked-out code and matching documentation; private chat history is not a prerequisite.

## Start here

1. Read [README](README.md) and [architecture and status](docs/architecture.md). Check `package.json` for the runtime/version.
2. Choose the [deployment model](docs/deployment-models.md): one business, separately operated customer instances, or a multi-tenant product. CRM product count and customer count are separate decisions.
3. For installation, follow [agent setup](docs/ai-setup.md) and the single [acceptance checklist](docs/setup.md). Reuse decisions/access already supplied; ask only for unresolved inputs. Documentation does not authorize spending, publishing a website or sending live conversions.
4. For integrations, read [offline-event mapping](docs/offline-event-mapping.md), then the exact [event](docs/events.md), [CRM](docs/crm.md) and [API](docs/api.md) contracts. Most CRM adapters must be implemented by the installer.
5. For optional advertising, read [ad-account setup](docs/ad-accounts.md). Separate application login, provider authorization and provider review. The stock kit has a read-token dashboard, not customer signup or a multi-tenant OAuth portal.

## Code and validation

- `public/`: website pixel and dashboard; `core/`: validation, attribution and destination contracts; `server/`: HTTP, SQLite and workers; `test/`: standalone regression coverage. See the [source map](docs/architecture.md#source-map).
- Node.js 24.14.x; ES modules; no package dependencies to install. Run `pnpm test`, or `node --test test/*.test.mjs` without a package manager. Existing documentation tests validate local links and anchors.
- Prefer pure, reusable provider mapping over customer-specific branches in shared attribution logic. Keep customer credentials, field mappings, cursors and destination choices in private per-connection configuration.
- Check the actual exports and validators before adding payload fields. A configuration worksheet is not an API payload. Keep docs, examples and code consistent.
- For a documentation-only change, review the diff and run the existing relevant checks. Do not create a demonstration website or provision infrastructure unless requested.

## Preserve these boundaries

- One process/database per website in the stock kit. No shared customer write token or implicit multi-tenant mode.
- Writes and provider credentials stay on trusted servers. Never commit `.env`, downloaded credentials, customer records or completed worksheets.
- Tracking requires consent and respects GPC. A missing session must not block the customer's enquiry. Fingerprint candidates do not establish verified identity.
- Keep source IDs, original times, revision ordering and integer currency minor units. A won job is not collected revenue; retries are not new outcomes.
- Offline outcomes enter the server and optionally go to Meta/Google through server APIs. Do not fabricate a browser visit or fire a browser purchase to represent an offline payment.
- Keep advertising disabled until authorized and separately verified. Distinguish stored outcome, linked report, provider acceptance, ad matching and performance improvement.

Hand back the changed files/version, checks actually run, and unverified or blocked installation steps. Use [verification](docs/verify.md) for live installation evidence; automated tests alone do not establish live CRM or ad-account success.
