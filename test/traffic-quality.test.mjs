import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserBotReason } from "../core/traffic-quality.mjs";
import { collectBrowserDiagnostics } from "../core/browser-diagnostics.mjs";
import { openStore } from "../server/store.mjs";
import { createKitServer } from "../server/app.mjs";

test("bot policy preserves mobile visitors and distinguishes strong signals", () => {
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36", "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0"]) {
    assert.equal(browserBotReason(ua, false, null, null), null);
  }
  assert.equal(browserBotReason("Mozilla", true, false, 99), "browser_webdriver");
  assert.equal(browserBotReason("Mozilla", false, true, 99), "verified_bot");
  assert.equal(browserBotReason("Mozilla", false, false, 29), "low_bot_score");
  assert.equal(browserBotReason("Mozilla", false, false, 30), null);
  assert.equal(browserBotReason("Mozilla", false, false, null), null);
  assert.equal(browserBotReason("Googlebot", false, false, null), "bot_user_agent");
  assert.equal(browserBotReason("", false, false, null), "empty_user_agent");
});

test("the ad-element probe has an independent control, always cleans up, and reports unavailable safely", () => {
  for (const mode of ["clear", "bait", "both", "throws", "append-throws", "no-body"]) {
    const children = [];
    const body = { appendChild(node) { if (mode === "append-throws" && children.length) throw new Error("DOM unavailable"); children.push(node); node.parentNode = body; }, removeChild(node) { children.splice(children.indexOf(node), 1); node.parentNode = null; } };
    const doc = { body: mode === "no-body" ? null : body, createElement() { return { style: {}, setAttribute() {}, offsetWidth: 1, offsetHeight: 1 }; } };
    const win = { getComputedStyle(node) { if (mode === "throws") throw new Error("Style unavailable"); return { display: mode === "both" || (mode === "bait" && node.className.includes("adsbox")) ? "none" : "block", visibility: "visible" }; } };
    assert.deepEqual(collectBrowserDiagnostics(win, doc, { webdriver: false }), { version: 1, webdriver: false, adBlockStatus: mode === "clear" ? "not_detected" : mode === "bait" ? "detected" : "unknown" });
    assert.equal(children.length, 0);
  }
});

test("filtered visits do not create attribution and ad blocking does not change outcomes, revenue or exports", () => {
  const store = openStore(":memory:", "example", null, null, null);
  const now = new Date().toISOString();
  const range = { from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 1000).toISOString(), model: "last_non_direct" };
  const visit = { siteId: "example", visitorId: randomUUID(), eventId: randomUUID(), occurredAt: now, url: "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=roof", browserDiagnostics: { version: 1, webdriver: true, adBlockStatus: "detected" } };
  try {
    const filtered = store.collect(visit, "https://example.com", now, { userAgent: "Mozilla" });
    assert.deepEqual(filtered, { status: "filtered", reason: "browser_webdriver", visitorSessionId: null, duplicate: false });
    assert.equal(store.collect(visit, "https://example.com", now, { userAgent: "Mozilla" }).duplicate, true);
    assert.equal(store.recovery(range).browsers.length, 0);
    const clean = { ...visit, eventId: randomUUID(), browserDiagnostics: { ...visit.browserDiagnostics, webdriver: false } };
    const accepted = store.collect(clean, "https://example.com", now, { userAgent: "Mozilla" });
    store.collect(clean, "https://example.com", now, { userAgent: "Mozilla" });
    const returned = store.collect({ ...clean, eventId: randomUUID(), url: "https://example.com/return", occurredAt: new Date(Date.parse(now) + 1).toISOString() }, "https://example.com", now, { userAgent: "Mozilla" });
    assert.equal(returned.visitorSessionId, accepted.visitorSessionId);
    const payment = { source: "crm", externalId: "invoice-test", eventType: "payment", outcome: "completed", occurredAt: new Date(Date.parse(now) + 2).toISOString(), sourceUpdatedAt: new Date(Date.parse(now) + 2).toISOString(), visitorSessionId: accepted.visitorSessionId, amountMinor: 125050, currency: "USD" };
    store.importOutcome(payment, now);
    const report = store.report(range, now).report;
    assert.equal(report.linkedOutcomes, 1);
    assert.equal(report.totals.revenueByCurrency.USD, 125050);
    assert.equal(report.groups[0].campaign, "roof");
    assert.equal(report.groups[0].source, "Google Ads");
    const exported = store.exportOutcomes(null);
    assert.equal(exported.records[0].amountMinor, 125050);
    assert.equal(Object.hasOwn(exported.records[0], "browserDiagnostics"), false);
    assert.deepEqual(store.trafficChecks(range).adBlock, { detected: 2, not_detected: 0, unknown: 0 });
    assert.equal(store.trafficChecks(range).filtered, 1);
    assert.throws(() => store.collect({ ...visit, url: "https://example.com/changed" }, "https://example.com", now), /different data/);
  } finally { store.close(); }
});

test("public HTTP collector filters crawler requests, ignores forged edge scores and protects diagnostics", async () => {
  const app = createKitServer({ siteId: "example", origins: ["https://example.com"], publicUrl: "http://127.0.0.1", database: ":memory:", writeToken: "w".repeat(32), readToken: "r".repeat(32) });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const now = new Date().toISOString();
  const visit = { siteId: "example", visitorId: randomUUID(), occurredAt: now, url: "https://example.com/?utm_source=test" };
  const post = ua => fetch(url + "/v1/collect", { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json", "User-Agent": ua, "x-po-bot-score": "1", "cf-verified-bot": "true" }, body: JSON.stringify({ ...visit, eventId: randomUUID() }) });
  try {
    assert.equal((await (await post("Googlebot")).json()).reason, "bot_user_agent");
    assert.equal((await (await post("")).json()).reason, "empty_user_agent");
    assert.ok((await (await post("Mozilla/5.0 Mobile Safari")).json()).visitorSessionId);
    const query = new URLSearchParams({ from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 1000).toISOString() });
    assert.equal((await fetch(url + "/v1/traffic-checks?" + query)).status, 401);
    const summary = await (await fetch(url + "/v1/traffic-checks?" + query, { headers: { Authorization: `Bearer ${"r".repeat(32)}` } })).json();
    assert.equal(summary.accepted, 1);
    assert.equal(summary.filtered, 2);
    assert.equal(summary.adBlock.unknown, 1);
  } finally { await app.close(); }
});

test("an existing database upgrades without changing historical visits or inventing clear checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "kit-checks-upgrade-"));
  const database = join(directory, "kit.sqlite");
  const old = new DatabaseSync(database);
  const now = new Date().toISOString(), session = randomUUID();
  old.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,visitor_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL); CREATE TABLE visits(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),occurred_at TEXT NOT NULL,url TEXT NOT NULL,referrer TEXT,payload_hash TEXT NOT NULL);");
  old.prepare("INSERT INTO sessions VALUES(?,?,?)").run(session, randomUUID(), now);
  old.prepare("INSERT INTO visits VALUES(?,?,?,?,?,?)").run(randomUUID(), session, now, "https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=old", null, "historical-digest");
  old.close();
  const store = openStore(database, "example", null, null, null);
  try {
    const range = { from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 1000).toISOString(), model: "first_touch" };
    assert.equal(store.recovery(range).browsers[0].pageviews, 1);
    assert.equal(store.trafficChecks(range).accepted, 0);
    assert.equal(store.trafficChecks(range).adBlock.not_detected, 0);
    store.importOutcome({ source: "crm", externalId: "historic-sale", eventType: "payment", outcome: "completed", visitorSessionId: session, occurredAt: now, sourceUpdatedAt: now, amountMinor: 50000, currency: "USD" }, now);
    assert.equal(store.report(range, now).report.groups[0].campaign, "old");
    assert.equal(store.exportOutcomes(null).records[0].amountMinor, 50000);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
