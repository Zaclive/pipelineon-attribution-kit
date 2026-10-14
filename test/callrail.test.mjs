import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCallrailWebhook, mapCallrailCall, fetchCallrailCall, processCallrailQueue } from "../server/callrail.mjs";
import { openStore } from "../server/store.mjs";
import { createKitServer } from "../server/app.mjs";
import { metaEligibility } from "../core/index.mjs";

const config = { accountId: "ACC123", companyId: "COM123", cookieName: "oa_callrail_test", deliveryOwner: "self", apiKey: "synthetic_api_key_123", signingKey: "synthetic_signing_key_123" };
const now = new Date().toISOString();
const call = { id: "CAL123", company_id: "COM123", answered: true, direction: "inbound", start_time: now, lead_status: "good_lead", customer_phone_number: "+12025550123", custom: {} };
const sign = body => createHmac("sha1", config.signingKey).update(body).digest("base64");
const destination = { datasetId: "123456789", mode: "test", testEventCode: "TEST123", accessToken: "synthetic_meta_token_12345" };
const options = raw => ({ limit: 5, now: () => now, config: async () => config, fetcher: async () => Response.json(raw) });

test("CallRail verifies the raw bytes and company before accepting a reference", () => {
  const body = Buffer.from(JSON.stringify(call));
  assert.equal(verifyCallrailWebhook(body, sign(body), config.signingKey, config.companyId).callId, "CAL123");
  for (const signature of [null, "short", "é".repeat(28), sign(Buffer.from("different"))]) assert.throws(() => verifyCallrailWebhook(body, signature, config.signingKey, config.companyId), { code: "CALLRAIL_SIGNATURE" });
  assert.throws(() => verifyCallrailWebhook(Buffer.concat([body, Buffer.from(" ")]), sign(body), config.signingKey, config.companyId), { code: "CALLRAIL_SIGNATURE" });
  assert.throws(() => verifyCallrailWebhook(body, sign(body), config.signingKey, "OTHER"), { code: "CALLRAIL_COMPANY" });
  assert.throws(() => verifyCallrailWebhook(Buffer.alloc(65537), "", config.signingKey, config.companyId), { status: 413 });
});

test("CallRail needs explicit qualification and paired consent, never infers revenue or caller identity from the tracking number", () => {
  const session = randomUUID();
  const custom = { [config.cookieName]: session, [config.cookieName + "_ads"]: session };
  const mapped = mapCallrailCall({ ...call, custom }, config, now);
  assert.equal(mapped.qualification, "qualified"); assert.equal(mapped.amountMinor, null); assert.equal(mapped.meta.consent, "granted");
  assert.equal(mapped.meta.userData.phoneSha256.length, 64); assert.equal(metaEligibility(mapped, now), null);
  assert.ok(!JSON.stringify(mapped).includes(call.customer_phone_number));
  for (const lead_status of ["not_scored", "previously_marked_good_lead", undefined]) assert.equal(mapCallrailCall({ ...call, custom, lead_status }, config, now).qualification, "unknown");
  for (const changed of [{ custom: {} }, { direction: "outbound" }, { custom: { ...custom, [config.cookieName + "_ads"]: randomUUID() } }])
    assert.equal(mapCallrailCall({ ...call, custom, ...changed }, config, now).meta.consent, "denied");
  assert.deepEqual(mapCallrailCall({ ...call, custom, customer_phone_number: null, tracking_phone_number: "+12025550999" }, config, now).meta.userData, {});
  assert.throws(() => mapCallrailCall({ ...call, call_type: "in_progress" }, config, now), { code: "CALLRAIL_IN_PROGRESS" });
});

test("API requests pin the account and call, stop redirects, and classify retryable failures without saving provider text", async () => {
  const raw = await fetchCallrailCall(config, call.id, async (url, init) => {
    assert.equal(new URL(url).host, "api.callrail.com"); assert.ok(url.includes("/ACC123/calls/CAL123.json"));
    assert.equal(init.redirect, "error"); assert.ok(init.headers.Authorization.includes(config.apiKey)); return Response.json(call);
  });
  assert.equal(raw.id, call.id);
  for (const [status, expected] of [[429, 429], [503, 503], [401, 422], [404, 422]])
    await assert.rejects(fetchCallrailCall(config, call.id, async () => new Response("secret provider text", { status })), { status: expected });
  await assert.rejects(fetchCallrailCall(config, call.id, async () => Response.json({ ...call, company_id: "OTHER" })), { code: "CALLRAIL_COMPANY" });
});

test("durable visit to CallRail to Meta flow preserves source, duplicate receipts and separate payment revenue", async () => {
  const store = openStore(":memory:", "site", destination, config);
  try {
    const visit = store.collect({ siteId: "site", visitorId: randomUUID(), eventId: randomUUID(), occurredAt: now, url: "https://example.test/?utm_source=facebook&utm_campaign=hvac", referrer: null }, "https://example.test", now);
    const custom = { [config.cookieName]: visit.visitorSessionId, [config.cookieName + "_ads"]: visit.visitorSessionId };
    store.callrail.enqueue(call.id, "first", now);
    await processCallrailQueue(store.callrail, options({ ...call, custom, lead_status: "not_scored" }));
    assert.equal(store.exportOutcomes(null).records[0].qualification, "unknown");
    store.callrail.enqueue(call.id, "qualified", now);
    await processCallrailQueue(store.callrail, options({ ...call, custom }));
    assert.equal(store.exportOutcomes(null).records.length, 1);
    const version = store.exportOutcomes(null).records[0].sourceUpdatedAt;
    assert.equal(store.callrail.enqueue(call.id, "qualified", now).duplicate, true);
    // A delayed old webhook refetches current API state. It cannot resurrect its old contents.
    store.callrail.enqueue(call.id, "old-webhook", now);
    await processCallrailQueue(store.callrail, options({ ...call, custom }));
    assert.equal(store.exportOutcomes(null).records[0].sourceUpdatedAt, version);
    assert.equal(store.callrail.list().calls[0].reason, "imported_linked");
    const { processMetaQueue } = await import("../server/meta-delivery.mjs");
    let deliveries = 0;
    await processMetaQueue(store.meta, { limit: 5, now: () => now, send: async snapshot => {
      deliveries++; assert.equal(snapshot.body.data[0].event_name, "Lead"); assert.equal(snapshot.body.data[0].action_source, "phone_call");
      return { accepted: true, retryable: false, reason: "meta_received", httpStatus: 200, eventsReceived: 1, traceId: "synthetic-callrail" };
    } });
    assert.equal(deliveries, 1);
    const from = new Date(Date.parse(now) - 3600000).toISOString(), to = new Date(Date.parse(now) + 60000).toISOString();
    let report = store.report({ from, to, model: "first_touch" }, now).report;
    assert.equal(report.linkedOutcomes, 1); assert.equal(report.groups[0].source, "facebook"); assert.deepEqual(report.totals.revenueByCurrency, {});
    store.importOutcome({ source: "crm", externalId: "paid-invoice-1", occurredAt: now, sourceUpdatedAt: now, eventType: "payment", outcome: "completed", amountMinor: 125050, currency: "USD", visitorSessionId: visit.visitorSessionId }, now);
    report = store.report({ from, to, model: "last_touch" }, now).report;
    assert.deepEqual(report.totals.revenueByCurrency, { USD: 125050 });
  } finally { store.close(); }
});

test("worker leases recover after restart, stale workers cannot import, and unknown sessions lose advertising permission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "callrail-test-"));
  let store = openStore(join(dir, "db.sqlite"), "site", null, config);
  try {
    store.callrail.enqueue(call.id, "a", now);
    const old = await store.callrail.claim(now);
    store.close(); store = openStore(join(dir, "db.sqlite"), "site", null, config);
    const later = new Date(Date.parse(now) + 91000).toISOString();
    const current = await store.callrail.claim(later);
    const id = randomUUID(), mapped = mapCallrailCall({ ...call, custom: { [config.cookieName]: id, [config.cookieName + "_ads"]: id } }, config, now);
    assert.equal(await store.callrail.complete(old, mapped, later), false);
    assert.equal(await store.callrail.complete(current, mapped, later), true);
    assert.equal(store.exportOutcomes(null).records[0].visitorSessionId, null);
    assert.equal(store.exportOutcomes(null).records[0].meta.consent, "denied");
    assert.equal(store.callrail.list().calls[0].reason, "imported_unlinked");
    store.callrail.enqueue("CAL456", "retry", later);
    await processCallrailQueue(store.callrail, { ...options(call), now: () => later, fetcher: async () => new Response("rate limited", { status: 429 }) });
    assert.equal(store.callrail.list().calls.find(row => row.callId === "CAL456").status, "retry");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("HTTP webhook acknowledges durable receipt; forged payloads and read-only flushes fail", async () => {
  const app = createKitServer({ database: ":memory:", siteId: "site", publicUrl: "http://localhost", origins: ["https://example.test"],
    readToken: "r".repeat(32), writeToken: "w".repeat(32), callrail: config, callrailAutoStart: false, callrailFetch: async () => Response.json(call) });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const body = JSON.stringify(call);
    assert.equal((await fetch(root + "/webhooks/callrail", { method: "POST", body })).status, 401);
    assert.equal((await fetch(root + "/webhooks/callrail", { method: "POST", body, headers: { Signature: sign(body) } })).status, 202);
    assert.equal((await fetch(root + "/v1/callrail/flush", { method: "POST", headers: { Authorization: "Bearer " + "r".repeat(32) } })).status, 401);
    await app.flushCallrail();
    assert.equal(app.store.callrail.list().calls[0].status, "complete");
  } finally { await app.close(); }
});

test("a conflicting newer import is reported as failed instead of a successful call receipt", async () => {
  const store = openStore(":memory:", "site", null, config);
  try {
    const newer = new Date(Date.parse(now) + 60000).toISOString();
    store.importOutcome(mapCallrailCall({ ...call, answered: false }, config, newer), now);
    store.callrail.enqueue(call.id, "conflicting", now);
    await processCallrailQueue(store.callrail, options(call));
    assert.equal(store.callrail.list().calls[0].status, "failed");
    assert.equal(store.callrail.list().calls[0].reason, "CALLRAIL_IMPORT_CONFLICT");
    assert.equal(store.exportOutcomes(null).records[0].outcome, "missed");
  } finally { store.close(); }
});
