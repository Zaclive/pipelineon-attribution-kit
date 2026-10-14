# Give this setup task to your coding assistant

Use a coding assistant that can inspect your website/backend and run commands. The kit's read-only MCP tools can inspect reports and receipts; deployment and CRM-adapter development require a separate authorized coding environment.

Fill in [setup-brief.template.json](../examples/setup-brief.template.json). Store credential locations there, never values. Keep tokens in local ignored configuration or a hosting secret store. Supply access through secure connection flows. The owner supplies business definitions, consent decisions and authorized provider access; an assistant must not infer them.

## Copy this task

```text
Implement website-to-CRM attribution for my setup brief using this repository.

1. Read package.json, README.md and docs/setup.md at the installed commit.
   Follow docs/hosting.md, docs/pixel.md, docs/crm.md and docs/api.md.
   Use docs/gtm.md, docs/events.md, docs/meta.md, docs/google-ads.md and docs/callrail.md when needed; verify with
   docs/verify.md. Record the version and existing integrations. Preserve
   working form handlers and unrelated product functionality.

2. Make a short implementation checklist. Reuse my selected hosting and existing
   backend/workflow where practical. PipelineOn needs no separate kit server.
   The kit needs Node.js 24.14.x and persistent SQLite storage; do not deploy
   it unchanged as a Cloudflare Worker or stateless function.

3. Fill examples/crm-mapping.template.json from the actual source API/schema and
   my business definitions. Locate enquiry/job relationships, the accepted session,
   stable activity IDs, occurrence/revision times, qualification and payment units.
   Keep original fields and unknown values. Ask only about unresolved facts.

4. Configure authorized accounts and secrets. Use separate random read/write
   tokens for the self-hosted kit. Keep source credentials and destination write
   tokens on trusted servers. Never put secrets in a public document, commit,
   website script or URL. Reuse existing authorization. If account creation,
   purchase or access approval needs owner action, identify that exact step and
   continue independent work.

5. Install the correct consent-controlled pixel. Carry its accepted reference
   through the real form provider into the saved enquiry. Import a successful
   outcome only after the backend/CRM confirms it. Do not invent a browser
   Purchase API. Missing tracking must never block a customer action.

6. Reuse a suitable native connector or build one minimal adapter. Authenticate
   requests, pin the tenant/site, queue durably, normalize, retry safely and retain
   receipts. Do not expose an unauthenticated JSON-to-Meta relay. If Cloudflare is
   chosen, implement the receiver, queue, consumer and recovery requirements in
   docs/crm.md. Verify the real provider authentication and field names.

7. Pass the attribution checks before enabling advertising. Inventory existing
   senders and assign one owner per conversion. Start Meta in test mode and Google in validation mode, then run
   docs/verify.md. Preserve original times and stable IDs through retries. Never
   invent consent, qualification, payment or a successful provider receipt.

8. Verify the actual website and mobile form. Hand over deployed version, files
   changed, source mappings, required secret NAMES, redacted test IDs/receipts,
   linkage and revenue results, replay/restart results, rollback steps and blockers.
   Mark each step passed, failed, blocked or not tested. Mock success is not live
   provider acceptance; a firing pixel or an HTTP 200 alone is not completed setup.
```

## Resume and operate

Save the completed brief, mapping worksheet and redacted receipts in your private deployment repository. On later runs, inspect those and durable state before changing anything. Repair failed stages instead of recreating datasets, rotating working keys, importing all payments again or installing another pixel.

For reporting, connect the kit's `/mcp` using the read token and a client supporting authenticated Streamable HTTP. See the [exact tools and protocol](api.md#reports-tracking-doctor-and-assistant-tools). A write token belongs in the authorized adapter, not the read-only reporting connection.

These instructions are an implementation task, not a universal one-click installer. Inaccessible forms, missing API access, account reviews or unknown CRM meanings remain explicit blockers until resolved.
