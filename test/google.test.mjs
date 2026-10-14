import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBusinessEvent, validateOutcome, businessEventName, metaEventName, validateGoogle, validateGoogleDestination, googleEligibility } from "../core/index.mjs";
import { buildGoogleSnapshot, sendGoogle, readGoogleStatus, processGoogleQueue, googleTokenProvider } from "../server/google-delivery.mjs";
import { hashMatchingData } from "../server/matching.mjs";
import { openStore } from "../server/store.mjs";
import { createKitServer } from "../server/app.mjs";
const now = new Date().toISOString(), at = seconds => new Date(Date.parse(now) + seconds * 1000).toISOString();
const dest = { accountId: "1234567890", loginAccountId: null, mode: "live", conversionActions: { lead_received: "1", lead_qualified: "2", appointment_booked: "3", estimate_sent: "4", job_won: "5", payment_received: "6" } };
const envelope = { version: 1, deliveryOwner: "self", dataProvenance: "customer_provided", consent: { adUserData: "granted", adPersonalization: "denied" }, eventSource: "PHONE", adIdentifiers: { gclid: "synthetic-click" } };
const event = overrides => normalizeBusinessEvent({ name: "payment_received", externalId: "invoice-1", source: "crm", occurredAt: at(-60), sourceUpdatedAt: at(-30), amountMinor: 125050, currency: "USD", googleAds: envelope, ...overrides });
const hash = s => createHash("sha256").update(s).digest("hex");
test("canonical business names preserve meanings and reject invented or contradictory facts", () => {
  assert.equal(businessEventName(event({})), "payment_received");
  assert.equal(metaEventName(event({})), "Purchase");
  assert.equal(metaEventName(event({ name: "job_won" })), null);
  assert.equal(metaEventName(event({ name: "estimate_sent" })), null);
  assert.equal(metaEventName(event({ name: "appointment_booked" })), "Schedule");
  assert.equal(metaEventName(event({ name: "lead_qualified", channel: "call" })), "Lead");
  assert.throws(() => event({ name: "lead_qualified" }), /channel/);
  assert.throws(() => event({ name: "purchase" }), /supported/);
  assert.throws(() => event({ eventType: "payment" }), /meaning/);
  assert.throws(() => validateOutcome({ ...event({}), businessEvent: "job_won" }), /describe/);
  assert.equal(metaEventName({ eventType: "call", outcome: "received", qualification: "qualified" }), null);
});
test("Google has explicit ownership, consent, matching and conversion-action requirements", () => {
  assert.equal(googleEligibility(event({}), dest, now), null);
  assert.equal(googleEligibility(event({ googleAds: { ...envelope, consent: { adUserData: "denied", adPersonalization: "denied" } } }), dest, now), "consent_denied");
  assert.equal(googleEligibility(event({ googleAds: { ...envelope, deliveryOwner: "external" } }), dest, now), "external_sender");
  assert.equal(googleEligibility(event({ googleAds: { ...envelope, adIdentifiers: {} } }), dest, now), "matching_data_missing");
  assert.equal(googleEligibility(event({}), { ...dest, conversionActions: {} }, now), "conversion_action_missing");
  assert.throws(() => validateGoogle({ ...envelope, userData: { emailSha256: "raw@example.com" } }), /SHA-256/);
  assert.throws(() => validateGoogle({ ...envelope, eventSource: "SYSTEM_GENERATED" }), /actual/);
  assert.throws(() => validateGoogleDestination({ ...dest, conversionActions: { lead_received: "1", payment_received: "1" } }), /own conversion action/);
});
test("Google snapshots use the actual source, original time, stable transaction identity and currency minor units", () => {
  const a = buildGoogleSnapshot(event({}), "site", dest), b = buildGoogleSnapshot(event({}), "site", dest);
  assert.deepEqual(a, b); assert.equal(a.body.events[0].conversionValue, 1250.50);
  assert.equal(a.body.events[0].eventSource, "PHONE"); assert.equal(a.body.events[0].eventTimestamp, at(-60));
  assert.equal(a.body.destinations[0].productDestinationId, "6");
  assert.equal(a.body.events[0].consent.adPersonalization, "CONSENT_DENIED");
  assert.equal(buildGoogleSnapshot(event({ currency: "JPY" }), "site", dest).body.events[0].conversionValue, 125050);
  assert.equal(buildGoogleSnapshot(event({ name: "job_won" }), "site", dest).body.events[0].conversionValue, undefined);
});
test("server matching normalization differs by platform and does not guess phone countries", () => {
  const input = { email: " Jane.Doe+Offer@gmail.com ", phone: "+18005550199" };
  assert.equal(hashMatchingData(input, "meta").emailSha256, hash("jane.doe+offer@gmail.com"));
  assert.equal(hashMatchingData(input, "google_ads").emailSha256, hash("janedoe@gmail.com"));
  assert.equal(hashMatchingData(input, "meta").phoneSha256, hash("18005550199"));
  assert.equal(hashMatchingData(input, "google_ads").phoneSha256, hash("+18005550199"));
  assert.throws(() => hashMatchingData({ phone: "8005550199" }, "google_ads"), /E.164/);
});
test("Google upload validation and asynchronous submission are distinct from processing success", async () => {
  const snap = buildGoogleSnapshot(event({}), "site", dest);
  const submitted = await sendGoogle(snap, "synthetic", async () => Response.json({ requestId: "request-1" }));
  assert.equal(submitted.submitted, true); assert.equal(submitted.accepted, false);
  const validated = await sendGoogle({ ...snap, mode: "validate" }, "synthetic", async () => Response.json({}));
  assert.equal(validated.validated, true); assert.equal(validated.accepted, false);
  assert.equal((await sendGoogle(snap, "synthetic", async () => Response.json({}))).retryable, true);
  const status = state => Response.json({ requestStatusPerDestination: [{ destination: snap.body.destinations[0], requestStatus: state }] });
  assert.equal((await readGoogleStatus(snap, "request-1", "synthetic", async () => status("PROCESSING"))).processing, true);
  assert.equal((await readGoogleStatus(snap, "request-1", "synthetic", async () => status("SUCCESS"))).accepted, true);
  assert.equal((await readGoogleStatus(snap, "request-1", "synthetic", async () => status("PARTIAL_SUCCESS"))).accepted, false);
  const rejected = await sendGoogle(snap, "synthetic", async () => Response.json({ error: { status: "INVALID_ARGUMENT", message: "secret@example.com" } }, { status: 400 }));
  assert.equal(JSON.stringify(rejected).includes("secret@example.com"), false);
});
test("durable Google queue polls a submitted request after restart instead of uploading again", async () => {
  const folder = mkdtempSync(join(tmpdir(), "oa-google-")), file = join(folder, "db.sqlite");
  let store = openStore(file, "site", null, null, dest), uploads = 0, polls = 0, time = now;
  const options = { limit: 5, now: () => time, token: async () => "synthetic", send: async () => { uploads++; return { submitted: true, accepted: false, reason: "google_submitted", requestId: "request-1" }; },
    poll: async () => { polls++; return { accepted: true, reason: "google_processed", requestId: "request-1" }; } };
  try {
    store.importOutcome(event({}), now); await processGoogleQueue(store.googleAds, options);
    assert.equal(store.googleAds.list().deliveries[0].status, "submitted");
    store.close(); store = openStore(file, "site", null, null, dest); time = at(61);
    await processGoogleQueue(store.googleAds, options);
    assert.equal(uploads, 1); assert.equal(polls, 1);
    assert.equal(store.googleAds.list().deliveries[0].status, "accepted");
    assert.equal(store.importOutcome(event({}), time).status, "duplicate");
    await processGoogleQueue(store.googleAds, options); assert.equal(uploads, 1);
    assert.equal(JSON.stringify(store.googleAds.list()).includes("synthetic-click"), false);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
test("Google retries keep identity, source changes stop resending, and validation never becomes live replay", async () => {
  const folder = mkdtempSync(join(tmpdir(), "oa-google-retry-")); let time = now;
  const store = openStore(join(folder, "db.sqlite"), "site", null, null, { ...dest, mode: "validate" });
  const sent = [], options = { limit: 5, now: () => time, token: async () => "synthetic", send: async s => { sent.push(s); return sent.length === 1 ? { retryable: true, reason: "transport_uncertain" } : { validated: true, reason: "google_validated" }; }, poll: async () => assert.fail("No polling for validation") };
  try {
    store.importOutcome(event({}), now); await processGoogleQueue(store.googleAds, options); time = at(31); await processGoogleQueue(store.googleAds, options);
    assert.deepEqual(sent[0], sent[1]); assert.equal(store.googleAds.list().deliveries[0].status, "validated");
    time = at(100); await processGoogleQueue(store.googleAds, options); assert.equal(sent.length, 2);
    store.importOutcome(event({ amountMinor: 200000, sourceUpdatedAt: at(90) }), time);
    assert.equal(store.googleAds.list().deliveries[0].sourceChanged, true);
    assert.throws(() => store.googleAds.retry(store.googleAds.list().deliveries[0].id, time), /Inspect/);
  } finally { store.close(); rmSync(folder, { recursive: true, force: true }); }
});
test("canonical-event HTTP endpoint is authenticated and exposes safe Google status", async () => {
  const folder = mkdtempSync(join(tmpdir(), "oa-google-http-"));
  const config = { database: join(folder, "db.sqlite"), siteId: "site", origins: ["https://example.com"], publicUrl: "http://localhost:4310", readToken: "r".repeat(40), writeToken: "w".repeat(40), googleAds: { ...dest, mode: "validate" }, googleToken: async () => "synthetic", googleAutoStart: false, googleFetch: async () => Response.json({}) };
  const app = createKitServer(config); await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body, token) => fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = { name: "payment_received", externalId: randomUUID(), source: "crm", occurredAt: at(-60), sourceUpdatedAt: at(-30), amountMinor: 125050, currency: "USD", googleAds: envelope };
  try {
    assert.equal((await post("/v1/events", raw, config.readToken)).status, 401);
    assert.equal((await post("/v1/events", raw, config.writeToken)).status, 200);
    assert.equal((await post("/v1/google/flush", {}, config.readToken)).status, 401);
    await app.flushGoogle();
    const status = await fetch(base + "/v1/google", { headers: { Authorization: `Bearer ${config.readToken}` } });
    const data = await status.json(); assert.equal(data.deliveries[0].status, "validated");
    assert.equal(JSON.stringify(data).includes("synthetic-click"), false);
    assert.equal((await post("/v1/events", { ...raw, name: "invented" }, config.writeToken)).status, 400);
  } finally { await app.close(); rmSync(folder, { recursive: true, force: true }); }
});
test("Google OAuth refresh is server-only, bounded and cached", async () => {
  let calls = 0;
  const token = googleTokenProvider({ clientId: "id", clientSecret: "secret", refreshToken: "refresh" }, async (url, init) => {
    calls++; assert.equal(url, "https://oauth2.googleapis.com/token"); assert.match(init.body, /grant_type=refresh_token/);
    return Response.json({ access_token: "synthetic-token-".repeat(3), expires_in: 3600 });
  }, () => Date.parse(now));
  assert.equal(await token(), await token()); assert.equal(calls, 1);
});
