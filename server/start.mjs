import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createKitServer } from "./app.mjs";
import { KitError } from "../core/index.mjs";
const database = resolve(process.env.KIT_DATABASE ?? "data/attribution.sqlite");
mkdirSync(dirname(database), { recursive: true });
const port = Number(process.env.PORT ?? 4310);
const meta = process.env.KIT_META_DATASET_ID ? { datasetId: process.env.KIT_META_DATASET_ID, mode: process.env.KIT_META_MODE ?? "disabled",
  testEventCode: process.env.KIT_META_TEST_EVENT_CODE ?? null, accessToken: process.env.KIT_META_ACCESS_TOKEN } : null;
if (!meta && (process.env.KIT_META_MODE && process.env.KIT_META_MODE !== "disabled" || process.env.KIT_META_ACCESS_TOKEN || process.env.KIT_META_TEST_EVENT_CODE)) {
  throw new KitError("CONFIG", "Set KIT_META_DATASET_ID before configuring Meta delivery.", 500);
}
const callrail = process.env.KIT_CALLRAIL_ACCOUNT_ID ? {
  accountId: process.env.KIT_CALLRAIL_ACCOUNT_ID, companyId: process.env.KIT_CALLRAIL_COMPANY_ID,
  apiKey: process.env.KIT_CALLRAIL_API_KEY, signingKey: process.env.KIT_CALLRAIL_SIGNING_KEY,
  cookieName: process.env.KIT_CALLRAIL_COOKIE_NAME, deliveryOwner: process.env.KIT_CALLRAIL_META_OWNER || "external",
} : null;
if (!callrail && Object.keys(process.env).some(key => key.startsWith("KIT_CALLRAIL_") && process.env[key]))
  throw new KitError("CONFIG", "Set KIT_CALLRAIL_ACCOUNT_ID before configuring CallRail.", 500);
const app = createKitServer({ database, siteId: process.env.KIT_SITE_ID, name: process.env.KIT_SITE_NAME ?? "My website",
  writeToken: process.env.KIT_WRITE_TOKEN, readToken: process.env.KIT_READ_TOKEN,
  publicUrl: process.env.KIT_PUBLIC_URL ?? `http://localhost:${port}`,
  origins: (process.env.KIT_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean), meta, callrail });
app.server.listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(`Open attribution kit listening on port ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { app.close().then(() => process.exit(0)); });
