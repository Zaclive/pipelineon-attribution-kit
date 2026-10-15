# Host the attribution kit

Choose PipelineOn hosting, or run one kit instance per website with persistent storage. A Worker is optional.

## Choose hosting and understand free options

Provider allowances below were checked on 15 October 2026; verify current eligibility and limits before provisioning. MIT removes the software licence fee, not hosting or CRM/API charges.

| Option | What it runs | Cost and practical limit |
| --- | --- | --- |
| Your existing VPS/server | Entire kit using Docker Compose | No additional host subscription if capacity is already paid for; you operate uptime/backups. |
| Your laptop | Local demonstration using Node or Docker | No new hosting account; it stops when your machine sleeps and is not an always-on customer deployment. |
| Railway | Docker service plus a persistent volume | Free plan has USD 1 monthly credit and a 0.5 GB volume limit. Hobby starts at USD 5/month including USD 5 usage. Usage can exceed the allowance. [Plans](https://docs.railway.com/pricing/plans). |
| Oracle Cloud Always Free eligible VM | Entire kit using Docker Compose | Free eligible compute/storage within limits, subject to capacity; idle VMs may be reclaimed. Backups and availability remain your responsibility. [Eligibility](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). |
| Cloudflare Workers | Optional pixel proxy or custom CRM adapter | Workers Free allows 100,000 requests/day. Queues Free includes 10,000 operations/day and 24-hour message retention; retries consume operations. Does not host the unchanged SQLite kit. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/). |
| PipelineOn | Managed attribution service | Use the current PipelineOn plan; a separate kit server is unnecessary. |

Render Free web services cannot attach a persistent disk, so they are unsuitable for this kit's live SQLite database. A paid persistent-disk service is a different option. [Render limitations](https://render.com/docs/free).

## Use PipelineOn

1. Select the website and copy its snippet from Settings > Tracking.
2. Use a supported native integration or a website-authorized API key with `data:write`. Add only the read scopes needed for reporting/verification.
3. Custom adapters use `/api/v1/imports`, its batch wrapper and `Idempotency-Key`. See [CRM integration guide](api.md#send-to-the-correct-api).
4. Configure the website's Meta destination when needed. Provider tokens belong in secure settings, never the pixel.

Hosted users configure their website and integrations in PipelineOn.

## Run the MIT kit on a persistent server

Use a reviewed public-repository commit and its matching documentation. Clone with `git clone https://github.com/Zaclive/pipelineon-attribution-kit.git`, then `cd pipelineon-attribution-kit`. Tagged release downloads contain the files available at that tag. Record the version. The v0.4 runtime is Node.js 24.14.x; Docker pins it. Run commands from the kit root. Bash uses `cp`; on PowerShell use `Copy-Item`.

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
| `KIT_META_MODE`, `KIT_GOOGLE_MODE` | Both `disabled` initially. Leave optional provider fields empty until configuring them. |

You can generate the initial .env and single-script instructions with pnpm run setup --site https://www.example.com --url https://attribution.example.com --name "Your business". It refuses to overwrite .env and keeps generated credentials out of output. Add additional exact origins if the website uses both www and its apex. For manual configuration, generate each token locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Run twice and save privately. Both tokens must be different and at least 32 characters. Restrict `.env` access; never paste secrets into documentation or commit them.

```sh
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:4310/health
```

The supplied compose file binds the port to loopback and uses the `attribution-data` named volume. Run one process/replica per database. The host must preserve the volume through restarts/deployments. `/health` confirms process/version, not CRM linkage or delivery.

For Node without Docker, install Node.js 24.14.x and pnpm, then run `pnpm start` from the kit root under a service manager and retain the `data/` directory. `pnpm test` runs the standalone suite. There are no runtime package dependencies.

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

## Deploy the kit on Railway

Railway is hosting, not a CRM connector. This recipe deploys the included Dockerfile as one persistent service:

1. Fork the public repository to an account you control. Select that repository in a new Railway project. Choose a reviewed commit/branch. The kit root contains the [Dockerfile](../Dockerfile); Railway detects it there. [Docker builds](https://docs.railway.com/builds/dockerfiles).
2. Attach a persistent volume at `/app/data` before accepting customer traffic. Keep one replica. See [volume configuration](https://docs.railway.com/volumes).
3. Add the values from `.env.example` through service variables. Set `HOST=0.0.0.0`, `PORT=4310`, `KIT_DATABASE=/app/data/attribution.sqlite`, site ID/name, exact allowed website origins, and separate random read/write tokens. Leave optional provider variables unset while disabled. Never commit `.env`.
4. The included image runs as user `node`. Railway documents root-owned volume mounts and recommends `RAILWAY_RUN_UID=0` for such images. This runs the container as root. For a non-root deployment, arrange writable volume ownership before starting; do not silently switch to ephemeral storage when permissions fail. [Mount permissions](https://docs.railway.com/volumes#permissions).
5. Generate a Railway HTTPS domain or attach your domain, with target port 4310. Put that exact HTTPS origin in `KIT_PUBLIC_URL`. Redeploy after configuration is complete. Keep the Docker start command.
6. Set the deployment healthcheck path to `/health`. Disable sleeping/serverless operation for a live installation so the background delivery worker can run while no visitors are present.
7. Verify `/health`, then a tagged synthetic visit and saved test outcome. Restart/redeploy and confirm that the same report and receipts remain. Check volume usage and backup/restore before launch.
8. Set usage alerts and review the plan limit. A small credit is not a promise of free 24/7 hosting. Follow [verification checklist](verify.md) before enabling real conversions.

## Put the pixel behind an optional Cloudflare Worker

The browser still runs `pixel.js`. This Worker proxies only the standalone kit's public script and collection routes to your existing HTTPS kit origin. The database, reports and advertising workers remain on that origin. Hosted PipelineOn users should use their supplied snippet rather than this kit-only proxy.

The files are [cloudflare-pixel-proxy.mjs](../examples/cloudflare-pixel-proxy.mjs) and [cloudflare-pixel-wrangler.json](../examples/cloudflare-pixel-wrangler.json). They block private API paths, strip browser credentials, preserve the website Origin/CORS response and stop redirects. There are no private keys in this public proxy.

1. Deploy and test the kit first. Set `KIT_ORIGIN` in the example Wrangler file to its HTTPS origin, without a path. It must not point back to this Worker.
2. Authenticate Wrangler to your Cloudflare account and inspect the deployment before publishing. From the kit root:

```sh
pnpm dlx wrangler@4.150.0 login
pnpm dlx wrangler@4.150.0 deploy --config examples/cloudflare-pixel-wrangler.json --dry-run
pnpm dlx wrangler@4.150.0 deploy --config examples/cloudflare-pixel-wrangler.json
```

3. Use its assigned HTTPS hostname, or attach `track.yourdomain.com` through [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Pin the CLI version in your own deployment project after verification. [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
4. Change only the kit pixel's script host to that Worker hostname. The pixel derives its collector origin from its script URL. Keep the same site ID and consent wiring. Add the Worker origin to website CSP; retain the actual website origin in the kit's `KIT_ALLOWED_ORIGINS`. Keep dashboard/private integrations on the original kit origin.
5. Test the script, an allowed collection preflight/POST, denied website origins and a private path such as `/v1/outcomes` returning 404 at the Worker. Check that a tagged visit still receives the real session reference. Configure throttling at the edge/origin and avoid retaining request bodies in logs.

This proxy is optional and stores no queue or fallback data. An unavailable origin means collection fails gracefully. It is separate from a custom CRM relay and does not bypass consent or browser privacy controls.

## Preserve the database

Stop the kit before backing up the complete volume, including SQLite WAL files. Record its release version. Test restore on a separate instance with advertising disabled, then restart and verify the original instance.

For upgrades, retain the database/private configuration and review release changes. Do not run `docker compose down -v` as a routine upgrade; that removes the volume. A restored older database can lose newer delivery receipts, so reconcile before resuming advertising. Never run two active kit processes against one database.

## Check the common hosting failures

- **Local demo:** use an HTTP development website, not a `file://` page. Add its exact origin, including port, to `KIT_ALLOWED_ORIGINS`. HTTPS websites cannot use an insecure public collector.
- **Behind a proxy:** this kit rate-limits the directly connected address to 600 requests/minute. Several visitors can share a proxy address, and collection preflights also count. Load-test the complete route; do not promise a per-visitor quota or trust arbitrary forwarded-IP headers to bypass the limit.
- **Sleeping service:** no requests does not mean no work. Delivery retries need the process running.
- **Disk errors:** a missing, full or unwritable volume must be fixed before importing. Never fall back to temporary disk.
- **Worker with CallRail:** only `pixel.js` and `/v1/collect` use the example proxy. Load `callrail.js` and configure webhooks on the original kit origin; private imports remain there too.

For a custom CRM Worker, use [CRM middleware](crm.md#optional-cloudflare-crm-relay). Run [verification](verify.md) before collecting live outcomes.

## Database and CRM costs

SQLite is included with no database licence fee. You pay for its persistent disk as part of hosting. Cloudflare D1 and hosted PostgreSQL are alternatives only after writing and testing a storage adapter; the current kit has no database-provider toggle. Reuse an existing CRM where possible. A CRM subscription does not host this kit or automatically supply payment events.

For a regional price example checked 15 October 2026, [Pipedrive Lite](https://www.pipedrive.com/en/pricing) displayed AU$19 per seat/month billed annually (AU$228 per seat/year), with a 14-day trial. This is not a universal $20 price or a requirement to buy Pipedrive. Verify local currency, billing term, API permissions and any workflow/adapter charges before choosing a plan.
