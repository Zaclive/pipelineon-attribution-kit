import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKitServer } from "../server/app.mjs";
import { openStore } from "../server/store.mjs";
import { buildMetaSnapshot, processMetaQueue, sendMeta, encryptMetaSecret, decryptMetaSecret } from "../server/meta-delivery.mjs";
import { validateOutcome, validateMeta, validateMetaDestination, metaEligibility, metaRetry } from "../core/index.mjs";

const destination = { datasetId: "123456789", mode: "test", testEventCode: "TEST123", accessToken: "local-test-token-never-send-to-meta" };
const now = new Date().toISOString();
const at = seconds => new Date(Date.parse(now) + seconds * 1000).toISOString();
const hash = value => createHash("sha256").update(value).digest("hex");
function outcome(overrides) { return validateOutcome({ source: "crm", externalId: "payment-1", eventType: "payment", outcome: "completed", occurredAt: at(-60), sourceUpdatedAt: at(-30), amountMinor: 125050, currency: "USD",
  meta: { version: 1, deliveryOwner: "self", consent: "granted", dataProvenance: "customer_provided", deduplication: "shared_event_id", eventId: "order-1", actionSource: "website",
    eventSourceUrl: "https://example.com/thanks?token=private&utm_source=facebook", userData: { emailSha256: hash("synthetic@example.com"), clientUserAgent: "Synthetic test", fbc: "fb.1.1790000000000.synthetic" } }, ...overrides }); }
function runner(store, send, time) { return processMetaQueue(store.meta, { limit: 10, now: () => time, send }); }
const received = () => Promise.resolve({ accepted: true, retryable: false, reason: "meta_received", httpStatus: 200, eventsReceived: 1, traceId: "synthetic_trace" });

test("HTTP visit -> outcome -> Meta-shaped delivery, retry, receipt and restart preserves IDs and attribution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "open-attribution-meta-"));
  const calls = [];
  const config = { database: join(directory, "kit.sqlite"), siteId: "test", name: "Test", origins: ["https://example.com"], publicUrl: "http://localhost:4310",
    readToken: "r".repeat(40), writeToken: "w".repeat(40), meta: destination, metaAutoStart: false,
    metaFetch: async (url, init) => { calls.push({ url, init }); return Response.json(calls.length === 1 ? { error: { code: 2, is_transient: true, message: "raw secret text must not persist" } } : { events_received: 1, fbtrace_id: "test_receipt", messages: [] }, { status: calls.length === 1 ? 503 : 200 }); } };
  let app = createKitServer(config);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, body, token) => { const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  try {
    const collect = await fetch(base + "/v1/collect", { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: JSON.stringify({ siteId: "test", visitorId: randomUUID(), eventId: randomUUID(), occurredAt: at(-120), url: "https://example.com/?utm_source=facebook&utm_campaign=qa", referrer: "" }) });
    const session = (await collect.json()).visitorSessionId;
    const event = outcome({ visitorSessionId: session });
    assert.equal((await post("/v1/outcomes", event, config.writeToken)).body.status, "created");
    assert.equal((await post("/v1/meta/flush", {}, config.readToken)).status, 401);
    await app.flushMeta();
    assert.equal(app.store.meta.list().deliveries[0].status, "retry");
    assert.equal(app.store.meta.list().deliveries[0].history.length, 1);
    assert.equal((await post("/v1/outcomes", event, config.writeToken)).body.status, "duplicate");
    await runner(app.store, (snapshot, token) => sendMeta(snapshot, token, config.metaFetch), at(31));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/123456789/events");
    assert.equal(calls[0].init.body, calls[1].init.body);
    const sent = JSON.parse(calls[1].init.body);
    assert.equal(sent.test_event_code, "TEST123");
    assert.equal(sent.data[0].event_id, "order-1");
    assert.equal(sent.data[0].event_name, "Purchase");
    assert.equal(sent.data[0].custom_data.value, 1250.5);
    assert.equal(sent.data[0].event_time, Math.floor(Date.parse(event.occurredAt) / 1000));
    assert.equal(sent.data[0].event_source_url.includes("private"), false);
    assert.equal(sent.data[0].user_data.fbc, event.meta.userData.fbc);
    const status = app.store.meta.list();
    assert.equal(status.deliveries[0].status, "accepted");
    assert.equal(status.deliveries[0].receipt.traceId, "test_receipt");
    assert.equal(JSON.stringify(status).includes(destination.accessToken), false);
    assert.equal(JSON.stringify(status).includes(event.meta.userData.emailSha256), false);
    assert.equal(JSON.stringify(status).includes("raw secret text"), false);
    const report = app.store.report({ from: at(-200), to: at(1), model: "first_touch" }, now);
    assert.equal(report.report.groups[0].source, "facebook");
    assert.equal(report.report.totals.revenueByCurrency.USD, 125050);
    await app.close(); app = createKitServer(config);
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    await app.flushMeta();
    assert.equal(calls.length, 2);
    assert.equal(app.store.meta.list().deliveries[0].history.length, 2);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("leases, concurrent claims and interrupted workers retain the original payload and attempt history", async () => {
  const store = openStore(":memory:", "test", destination);
  try {
    const event = outcome({}); store.importOutcome(event, now);
    const job = store.meta.claim(now);
    assert.equal(store.meta.claim(now), null);
    const started = store.meta.begin(job, buildMetaSnapshot(event, "test", destination), now);
    assert.equal(started.attempts, 1);
    let sent;
    await runner(store, async snapshot => { sent = snapshot; return received(); }, at(91));
    assert.deepEqual(sent, started.snapshot);
    const row = store.meta.list().deliveries[0];
    assert.equal(row.attempts, 2);
    assert.equal(row.history[0].receipt.reason, "worker_interrupted");
    assert.equal(row.status, "accepted");
    assert.throws(() => store.meta.finish(started, { status: "accepted", reason: "meta_received", receipt: null, nextAttemptAt: null }, at(92)), /lease changed/);
  } finally { store.close(); }
});

test("corrections before delivery apply; corrections or revoked consent after an attempt are not resent", async () => {
  for (const change of [{ amountMinor: 9900 }, { deleted: true }, { meta: { ...outcome({}).meta, consent: "denied" } }]) {
    const store = openStore(":memory:", "test", destination);
    try {
      const event = outcome({}); store.importOutcome(event, now);
      store.importOutcome({ ...event, amountMinor: 150000, sourceUpdatedAt: at(-10) }, now);
      let sends = 0;
      await runner(store, async snapshot => { sends++; assert.equal(snapshot.body.data[0].custom_data.value, 1500); return { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null }; }, now);
      store.importOutcome({ ...event, ...change, sourceUpdatedAt: at(1) }, at(1));
      await runner(store, async () => { sends++; return received(); }, at(31));
      assert.equal(sends, 1); assert.equal(store.meta.list().deliveries[0].status, "review");
    } finally { store.close(); }
  }
});

test("accepted outcomes stay accepted after a correction, and shared IDs across sources cannot send twice", async () => {
  const store = openStore(":memory:", "test", destination);
  try {
    const event = outcome({}); store.importOutcome(event, now);
    await runner(store, received, now);
    store.importOutcome({ ...event, deleted: true, sourceUpdatedAt: at(1) }, at(1));
    store.importOutcome({ ...event, source: "another-crm" }, at(1));
    let sends = 0; await runner(store, async () => { sends++; return received(); }, at(2));
    assert.equal(sends, 0);
    const rows = store.meta.list().deliveries;
    assert.equal(rows.find(row => row.source === "crm").sourceChanged, true);
    assert.equal(rows.find(row => row.source === "crm").status, "accepted");
    assert.equal(rows.find(row => row.source === "another-crm").reason, "event_identity_conflict");
    assert.throws(() => store.meta.retry(rows.find(row => row.source === "crm").id, at(2)), /cannot be retried/);
  } finally { store.close(); }
});

test("permissions, attribution-only imports, missing data and expired events never cause silent sends", async () => {
  const base = outcome({});
  for (const [change, reason] of [[{ deleted: true }, "outcome_deleted"], [{ meta: undefined }, "not_requested"],
    [{ meta: { ...base.meta, deliveryOwner: "external" } }, "external_sender"], [{ meta: { ...base.meta, consent: "denied" } }, "consent_denied"],
    [{ meta: { ...base.meta, userData: {} } }, "website_context_missing"], [{ occurredAt: at(-8 * 86400) }, "event_expired"], [{ amountMinor: null, currency: null }, "payment_value_missing"]]) {
    assert.equal(metaEligibility({ ...base, ...change }, now), reason);
  }
  const store = openStore(":memory:", "test", null);
  try { store.importOutcome(base, now); assert.equal(store.meta.claim(now), null); assert.equal(store.meta.list().counts.queued, 1); }
  finally { store.close(); }
  assert.throws(() => validateMeta({ ...base.meta, userData: { email: "secret@example.com" } }), /Unsupported/);
  assert.throws(() => validateMeta({ ...base.meta, eventId: null }), /same eventId/);
  assert.throws(() => validateMetaDestination({ datasetId: "123456", mode: "test" }), /test-event code/);
  assert.equal(metaRetry(8, now, Math.floor(Date.parse(now) / 1000), now, null), null);
  assert.equal(metaRetry(2, at(-46 * 3600), Math.floor(Date.parse(now) / 1000), now, null), null);
});

test("receipt parsing requires one acknowledged event and retries only safe classes of failure", async () => {
  const snapshot = buildMetaSnapshot(outcome({}), "test", destination);
  for (const [body, status, accepted, retryable] of [[{ events_received: 1 }, 200, true, false], [{ events_received: 0 }, 200, false, true], [{ error: { code: 190 } }, 400, false, false], [{ error: { code: 4 } }, 400, false, true], [{ error: { code: 100 } }, 400, false, false]]) {
    const result = await sendMeta(snapshot, "secret", async () => Response.json(body, { status }));
    assert.equal(result.accepted, accepted); assert.equal(result.retryable, retryable);
  }
  assert.equal((await sendMeta(snapshot, "secret", async () => { throw new TypeError("timeout"); })).reason, "transport_uncertain");
});

test("currency units, secret binding and stable generated identities are shared across adapters", () => {
  for (const [currency, amount, value] of [["USD", 125050, 1250.5], ["JPY", 125050, 125050], ["KWD", 125050, 125.05]]) {
    assert.equal(buildMetaSnapshot(outcome({ currency, amountMinor: amount }), "test", destination).body.data[0].custom_data.value, value);
  }
  const event = outcome({ meta: { ...outcome({}).meta, eventId: null, deduplication: "server_only" } });
  assert.equal(buildMetaSnapshot(event, "test", destination).eventId, buildMetaSnapshot({ ...event, sourceUpdatedAt: at(1) }, "test", destination).eventId);
  assert.notEqual(buildMetaSnapshot(event, "test", destination).eventId, buildMetaSnapshot(event, "other-site", destination).eventId);
  const encrypted = encryptMetaSecret("secret", "a".repeat(64), "org:site:dataset");
  assert.equal(decryptMetaSecret(encrypted, "a".repeat(64), "org:site:dataset"), "secret");
  assert.throws(() => decryptMetaSecret(encrypted, "a".repeat(64), "other:site:dataset"), /could not be decrypted/);
});
