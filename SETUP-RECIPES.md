# Choose a setup recipe

Use these recipes with [START-HERE.md](START-HERE.md). The shortest route is PipelineOn plus a direct pixel or GTM tag and a supported connector. Self-hosting adds a server and backups. Middleware is needed only when the source cannot supply the normalized API request reliably itself.

## Choose hosting and understand free options

Provider allowances below were checked on 14 October 2026; verify current eligibility and limits before provisioning. MIT removes the software licence fee, not hosting or CRM/API charges.

| Option | What it runs | Cost and practical limit |
| --- | --- | --- |
| Your existing VPS/server | Entire kit using Docker Compose | No additional host subscription if capacity is already paid for; you operate uptime/backups. |
| Your laptop | Local demonstration using Node or Docker | No new hosting account; it stops when your machine sleeps and is not an always-on customer deployment. |
| Railway | Docker service plus a persistent volume | Free plan has USD 1 monthly credit and a 0.5 GB volume limit. Hobby starts at USD 5/month including USD 5 usage. Usage can exceed the allowance. [Plans](https://docs.railway.com/pricing/plans). |
| Oracle Cloud Always Free eligible VM | Entire kit using Docker Compose | Free eligible compute/storage within limits, subject to capacity; idle VMs may be reclaimed. Backups and availability remain your responsibility. [Eligibility](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). |
| Cloudflare Workers | Optional pixel proxy or custom CRM adapter | Workers Free allows 100,000 requests/day. Queues Free includes 10,000 operations/day and 24-hour message retention; retries consume operations. Does not host the unchanged SQLite kit. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/). |
| PipelineOn | Managed attribution service | Use the current PipelineOn plan; a separate kit server is unnecessary. |

Render Free web services cannot attach a persistent disk, so they are unsuitable for this kit's live SQLite database. A paid persistent-disk service is a different option. [Render limitations](https://render.com/docs/free).

## Run the code locally or on your server

Clone the public code, choose a reviewed commit, and follow [DEPLOYMENT.md](DEPLOYMENT.md#run-the-mit-kit-on-a-persistent-server):

```sh
git clone https://github.com/Zaclive/pipelineon-attribution-kit.git
cd pipelineon-attribution-kit
cp .env.example .env
```

Fill the required website, origins and two private tokens. Use `Copy-Item` instead of `cp` in PowerShell if needed. Then choose one:

```sh
# Node.js 24.14.x and pnpm installed; preserves ./data
pnpm start
```

```sh
# Docker Engine and Compose installed; preserves the named volume
docker compose up --build -d
```

For a production VPS, add HTTPS, a tracking subdomain, process supervision and backups using [DEPLOYMENT.md](DEPLOYMENT.md#add-https-and-network-routing). For an Oracle eligible VM, use an eligible Linux compute instance and persistent boot/block storage, install Docker/Compose using the OS vendor's instructions, and apply this same recipe. Open HTTPS and the required certificate-validation route; restrict administrative SSH. Keep the kit's port 4310 private behind the proxy.

## Deploy the kit on Railway

Railway is hosting, not a CRM connector. This recipe deploys the included Dockerfile as one persistent service:

1. Fork the public repository to an account you control. Select that repository in a new Railway project. Choose a reviewed commit/branch. The kit root contains the [Dockerfile](Dockerfile); Railway detects it there. [Docker builds](https://docs.railway.com/builds/dockerfiles).
2. Attach a persistent volume at `/app/data` before accepting customer traffic. Keep one replica. See [volume configuration](https://docs.railway.com/volumes).
3. Add the values from `.env.example` through service variables. Set `HOST=0.0.0.0`, `PORT=4310`, `KIT_DATABASE=/app/data/attribution.sqlite`, site ID/name, exact allowed website origins, and separate random read/write tokens. Leave optional provider variables unset while disabled. Never commit `.env`.
4. The included image runs as user `node`. Railway documents root-owned volume mounts and recommends `RAILWAY_RUN_UID=0` for such images. This runs the container as root. For a non-root deployment, arrange writable volume ownership before starting; do not silently switch to ephemeral storage when permissions fail. [Mount permissions](https://docs.railway.com/volumes#permissions).
5. Generate a Railway HTTPS domain or attach your domain, with target port 4310. Put that exact HTTPS origin in `KIT_PUBLIC_URL`. Redeploy after configuration is complete. Keep the Docker start command.
6. Set the deployment healthcheck path to `/health`. Disable sleeping/serverless operation for a live installation so the background delivery worker can run while no visitors are present.
7. Verify `/health`, then a tagged synthetic visit and saved test outcome. Restart/redeploy and confirm that the same report and receipts remain. Check volume usage and backup/restore before launch.
8. Set usage alerts and review the plan limit. A small credit is not a promise of free 24/7 hosting. Follow [ACCEPTANCE.md](ACCEPTANCE.md) before enabling real conversions.

## Put the pixel behind an optional Cloudflare Worker

The browser still runs `pixel.js`. This Worker proxies only the standalone kit's public script and collection routes to your existing HTTPS kit origin. The database, reports and advertising workers remain on that origin. Hosted PipelineOn users should use their supplied snippet rather than this kit-only proxy.

The files are [cloudflare-pixel-proxy.mjs](examples/cloudflare-pixel-proxy.mjs) and [cloudflare-pixel-wrangler.json](examples/cloudflare-pixel-wrangler.json). They block private API paths, strip browser credentials, preserve the website Origin/CORS response and stop redirects. There are no private keys in this public proxy.

1. Deploy and test the kit first. Set `KIT_ORIGIN` in the example Wrangler file to its HTTPS origin, without a path. It must not point back to this Worker.
2. Authenticate Wrangler to your Cloudflare account and inspect the deployment before publishing. From the kit root:

```sh
pnpm dlx wrangler login
pnpm dlx wrangler deploy --config examples/cloudflare-pixel-wrangler.json --dry-run
pnpm dlx wrangler deploy --config examples/cloudflare-pixel-wrangler.json
```

3. Use its assigned HTTPS hostname, or attach `track.yourdomain.com` through [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). Pin the CLI version in your own deployment project after verification. [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
4. Change only the kit pixel's script host to that Worker hostname. The pixel derives its collector origin from its script URL. Keep the same site ID and consent wiring. Add the Worker origin to website CSP; retain the actual website origin in the kit's `KIT_ALLOWED_ORIGINS`. Keep dashboard/private integrations on the original kit origin.
5. Test the script, an allowed collection preflight/POST, denied website origins and a private path such as `/v1/outcomes` returning 404 at the Worker. Check that a tagged visit still receives the real session reference. Configure throttling at the edge/origin and avoid retaining request bodies in logs.

This proxy is optional and stores no queue or fallback data. An unavailable origin means collection fails gracefully. It is not the CRM relay below and does not bypass consent or browser privacy controls.

## Install through GTM or directly

Use [GTM.md](GTM.md) for the exact Custom HTML tag, consent events and preview checks. Use [PIXEL-EVENTS.md](PIXEL-EVENTS.md) for a direct website installation. Choose one installation method; either can use the kit origin or optional Worker hostname. A tracking tag alone does not save source fields into the CRM.

## Normalize offline activity and connect your CRM

Offline means the business result can happen after the website session, by phone, in a job system or in person. Keep its actual occurrence time and action source. Preserve the original enquiry's browser reference when known; a truly offline record can remain unlinked locally while having its own permitted Meta matching data.

Choose the least complex supported route:

| Source capability | Route and steps |
| --- | --- |
| Supported native connector | Connect the correct account/site, check which activities it already imports, and verify one real record. Use the bundled [CallRail](CALLRAIL.md) instructions or PipelineOn's available native integration. |
| CRM workflow with authenticated HTTP | Trigger on a confirmed business change, look up related enquiry/session fields, map the outcome, POST to the correct API, retain the response and retry transient failures. |
| Existing backend or Make/n8n/Zapier workflow | Fetch authoritative source data, map using [FIELD-MAPPING.md](FIELD-MAPPING.md), and send via an HTTP action with server-side credentials. Keep a durable retry/reconciliation record. This is generic HTTP, not a bundled native app. |
| CSV export | Map rows into outcome JSON using a CSV parser; validate and import in controlled batches. See the example below. The kit does not accept raw CSV at `/v1/outcomes`. |
| Provider webhooks or polling need custom code | Build an authenticated adapter on your server, Railway or Workers with a durable inbox, field mapping, revisions and receipts. The pixel proxy above does not implement it. |

Example source row: `transaction_id=pay_123`, `job_id=job_55`, `paid_at=2026-10-14T00:00:00Z`, `updated_at=2026-10-14T00:01:00Z`, `paid_amount=1250.50`, `currency=USD`, `status=settled`. Resolve `job_55` to its original enquiry session and normalize:

```json
{
  "source": "my-crm",
  "externalId": "company-1:payment:pay_123",
  "eventType": "payment",
  "outcome": "completed",
  "occurredAt": "2026-10-14T00:00:00Z",
  "sourceUpdatedAt": "2026-10-14T00:01:00Z",
  "visitorSessionId": null,
  "amountMinor": 125050,
  "currency": "USD"
}
```

The null above means the join is unknown; replace it only with the accepted session from that enquiry. Use exact decimal-to-minor-unit conversion, not binary float multiplication. Preserve source IDs/times on retries. Use a private QA copy with current synthetic times for Meta testing; never redate historical customer payments. Keep refunds, notes, won opportunities and bookings separate from collected payments.

The kit receives one such object at `POST /v1/outcomes` using `KIT_WRITE_TOKEN`. PipelineOn needs the batch wrapper, `kind: "event"`, website ID and stable `Idempotency-Key` in [INTEGRATIONS.md](INTEGRATIONS.md#4-send-to-the-correct-front-door). Validate first, retain one result per row, and stop on conflicting revisions. Neither CSV parsing nor a worksheet automatically interprets arbitrary CRM field meanings.

For a **Cloudflare CRM adapter**, create a separate project with receiver Worker, Queue, consumer, dead-letter handling and revision/cursor storage. Run `pnpm create cloudflare@latest` to scaffold, then implement the [relay requirements](DEPLOYMENT.md#optional-cloudflare-crm-relay) using your completed mapping. Store source/write credentials with `pnpm exec wrangler secret put NAME` in that project. Verify webhook authentication over original bytes, or use authenticated polling. Return success only after durable enqueue. This provider-specific adapter is an implementation task, not included in the public pixel proxy.

## Connect Facebook and prove delivery

Follow [META-SETUP.md](META-SETUP.md) for dataset access, server token, matching data, sender ownership, test code and receipt checks. Pass the complete source/revenue checks before enabling advertising. Give your coding assistant [AI-SETUP.md](AI-SETUP.md), the selected recipe and the completed private worksheets.
