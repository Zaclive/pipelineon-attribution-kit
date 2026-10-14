# Deploy the kit or use PipelineOn

Choose the shortest architecture that fits the source system. PipelineOn operates the collector, database and workers. The MIT kit runs those components in one Node.js process with a persistent SQLite volume. A CRM adapter can use your backend, automation platform or an optional Cloudflare Worker.

For provider-specific steps and free-tier limits, use [SETUP-RECIPES.md](SETUP-RECIPES.md). It includes Railway and an optional public pixel proxy; the CRM relay still needs source-specific implementation.

## Use PipelineOn

1. Select the website and copy its snippet from Settings > Tracking.
2. Use a supported native integration or a website-authorized API key with `data:write`. Add only the read scopes needed for reporting/verification.
3. Custom adapters use `/api/v1/imports`, its batch wrapper and `Idempotency-Key`. See [INTEGRATIONS.md](INTEGRATIONS.md#4-send-to-the-correct-front-door).
4. Configure the website's Meta destination when needed. Provider tokens belong in secure settings, never the pixel.

Hosted customers do not need a separate kit database, a Cloudflare account or PipelineOn platform encryption keys.

## Run the MIT kit on a persistent server

Download a [published kit](https://github.com/Zaclive/pipelineon-attribution-kit/releases) or check out a chosen public-repository commit. Record the version. The v0.3 runtime is Node.js 24.14.x; Docker pins it. Run commands from the kit root. Bash uses `cp`; on PowerShell use `Copy-Item`.

```sh
cp .env.example .env
```

Configure the private file:

| Setting | Value |
| --- | --- |
| `KIT_SITE_ID` | Stable identifier for this one website. Never reuse a database for a different site. |
| `KIT_SITE_NAME` | Dashboard label. |
| `KIT_PUBLIC_URL` | Public HTTPS kit origin, e.g. `https://attribution.example.com`. |
| `KIT_ALLOWED_ORIGINS` | Exact comma-separated website origins, including `www` if used. |
| `KIT_READ_TOKEN` | Random read/dashboard secret. |
| `KIT_WRITE_TOKEN` | Different random secret for trusted importers. |
| `KIT_META_MODE` | `disabled` initially. Leave optional provider fields empty until configuring them. |

Generate each token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Run twice and save privately. Both tokens must be different and at least 32 characters. Restrict `.env` access; never paste secrets into documentation or commit them.

```sh
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:4310/health
```

The supplied compose file binds the port to loopback and uses the `attribution-data` named volume. Run one process/replica per database. The host must preserve the volume through restarts/deployments. `/health` confirms process/version, not CRM linkage or delivery.

Alternatively install the required Node and pnpm, run `pnpm start` under a service manager and retain the `data/` directory. `pnpm test` runs the standalone suite. There are no runtime package dependencies.

## Add HTTPS and network routing

Point the selected tracking hostname at the server and use the existing Caddy/nginx/equivalent reverse proxy. A host-installed Caddy routing example is:

```caddyfile
attribution.example.com {
    reverse_proxy 127.0.0.1:4310
}
```

This is an illustrative routing stanza, not a bundled deployment file. Configure request limits and throttles in your proxy/firewall too. A proxy in another container must use the correct private service network, since its loopback refers to itself. Keep port 4310 private.

Public pixel/collector routes must be reachable by the website, and signed CallRail webhooks by CallRail when enabled. Private APIs retain bearer authentication. Scope Access/WAF rules so a login challenge does not intercept collection or webhooks. Never disable application authentication or signature verification to pass a setup check.

If Cloudflare proxies the hostname, preserve end-to-end TLS, raw request bodies and signature headers. Bypass caching for collection, private API, session and webhook responses; preserve `no-store`. Cloudflare DNS/proxy is separate from a Worker and is optional.

## Preserve the database

Stop the kit before backing up the complete volume, including SQLite WAL files. Record its release version. Test restore on a separate instance with advertising disabled, then restart and verify the original instance.

For upgrades, retain the database/private configuration and review release changes. Do not run `docker compose down -v` as a routine upgrade; that removes the volume. A restored older database can lose newer delivery receipts, so reconcile before resuming advertising. Never run two active kit processes against one database.

## Optional Cloudflare CRM relay

The repository does not contain a ready-made generic Worker. The kit's Node HTTP server and filesystem-backed SQLite store require an actual port to Workers storage/runtime, not merely a compatibility flag. See [Workers Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

```text
CRM webhook -> verified Worker receiver -> durable Queue
              -> consumer and revision ledger -> kit OR PipelineOn outcome API
              -> attribution and optional Meta queue
```

Give the assistant these implementation requirements when Cloudflare is your chosen adapter host:

1. Create the Worker, queue, consumer, dead-letter recovery and durable storage for object revisions, polling cursors and receipts. Follow the current [Cloudflare Queues guide](https://developers.cloudflare.com/queues/get-started/).
2. Put CRM credentials, webhook verification secrets and destination tokens in [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/). Pin destination origin and tenant/site in server configuration; never take an arbitrary forwarding URL or site from the request body.
3. Verify the provider's documented authentication over original bytes before parsing/mutation. Enforce its replay/timestamp protection when supplied, body limits and expected account. Without authenticated webhooks, use supported authenticated polling or another trusted route.
4. Await durable enqueue before acknowledgement. Retain only needed references/minimized data. A promise or `waitUntil` task alone is not a durable inbox. Do not log raw requests or authorization headers.
5. Re-read authoritative state when necessary, apply [FIELD-MAPPING.md](FIELD-MAPPING.md) and send the correct destination wrapper. Preserve activity IDs, original times and revisions across retries.
6. Acknowledge successful processing only after checking the importer result. Retry transient failures with bounded backoff and retain permanent failures for recovery. Reconcile missed webhooks and paginated API updates.
7. Test duplicates, out-of-order updates, revoked access, restart recovery and tenant isolation using [ACCEPTANCE.md](ACCEPTANCE.md).

A Queue receipt proves enqueue only; outcome and Meta receipts prove later stages. Hosting, CRM/API access and provider usage can incur charges despite the MIT licence.
