import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, buildTouches, trackingDoctor } from "../core/index.mjs";
import { openStore } from "../server/store.mjs";
const at = "2026-10-12T12:00:00Z";
const range = { from: "2026-10-12T00:00:00Z", to: "2026-10-13T00:00:00Z", model: "last_non_direct" };
const coverage = { limited: false, inspected: 1, limit: 100000 };
const fact = (id, type, outcome) => ({ externalId: id, source: "crm", eventType: type, outcome, occurredAt: at, sourceUpdatedAt: at, deleted: false });
function linked(parameters, referrer) {
  const touches = buildTouches([{ url: "https://example.com/?" + new URLSearchParams(parameters), referrer, occurredAt: "2026-10-12T11:00:00Z", visitorId: "browser" }], at);
  return { ...fact("form", "form", "received"), attribution: { status: "linked", evidence: "session_reference", touches } };
}
test("saved campaign IDs replace missing campaign labels and conflicts retain every field without a winner", () => {
  const clean = linked({ utm_source: "google", utm_medium: "ppc", gad_campaignid: "22133711419", hsa_cam: "22133711419" }, null);
  const conflict = linked({ utm_source: "google", utm_medium: "ppc", gad_campaignid: "17862178742", hsa_cam: "16577131354", gclid: "private-click" }, null);
  conflict.externalId = "conflict";
  const r = buildReport([clean, conflict], range, coverage);
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups.find(g => !g.campaignConflict).campaign, "Campaign ID 22133711419");
  const g = r.groups.find(g => g.campaignConflict);
  assert.equal(g.source, "Google Ads");
  assert.equal(g.campaign, "Conflicting campaign IDs");
  assert.deepEqual(g.campaignIds, { gad_campaignid: "17862178742", hsa_cam: "16577131354" });
  assert.equal(r.campaignConflictActivities, 1);
  assert.equal(JSON.stringify(r).includes("private-click"), false);
  assert.equal(trackingDoctor(r, { checkedAt: at, taggedPageviews: 1, lastPageviewAt: at }).checks.find(c => c.id === "campaign_conflicts").status, "action");
});
test("numeric UTM campaign IDs conflict, names remain names, distinct ID evidence never merges", () => {
  for (const [utm_campaign, expected] of [["111", true], ["Roofing", false]]) {
    const r = buildReport([linked({ utm_source: "google", utm_medium: "CPC", utm_campaign, gad_campaignid: "222" }, null)], range, coverage);
    assert.equal(r.groups[0].campaign, utm_campaign);
    assert.equal(r.groups[0].campaignConflict, expected);
  }
  const a = linked({ utm_campaign: "same name", gad_campaignid: "111", utm_source: "google" }, null);
  const b = linked({ utm_campaign: "same name", gad_campaignid: "222", utm_source: "google" }, null); b.externalId = "second";
  assert.equal(buildReport([a, b], range, coverage).groups.length, 2);
});
test("paid Google, Google referral, organic tags and unclassified Google remain distinct", () => {
  const cases = [
    [{ utm_source: "Google", utm_medium: "PPC" }, null, "Google Ads"],
    [{ gclid: "click" }, null, "Google Ads"],
    [{ wbraid: "click" }, null, "Google Ads"],
    [{ gad_campaignid: "123" }, "https://www.google.com/", "Google Ads"],
    [{ gad_campaignid: "123" }, null, "Google Ads"],
    [{}, "https://www.google.co.nz/search", "Google referral"],
    [{ utm_source: "google", utm_medium: "organic" }, null, "Google organic"],
    [{ utm_source: "google" }, null, "Google (unclassified)"],
    [{ utm_source: "newsletter" }, "https://www.google.com/", "newsletter"],
    [{}, "https://google.com.evil.example/", "google.com.evil.example"],
  ];
  for (const [p, referrer, source] of cases) assert.equal(buildReport([linked(p, referrer)], range, coverage).groups[0].source, source);
});
test("model selection never combines IDs across touches or credits a visit after the outcome", () => {
  const row = linked({}, null);
  row.attribution.touches = buildTouches([
    { url: "https://example.com/?utm_source=google&gad_campaignid=111", occurredAt: "2026-10-12T09:00:00Z", referrer: null, visitorId: "a" },
    { url: "https://example.com/?utm_source=google&hsa_cam=222", occurredAt: "2026-10-12T10:00:00Z", referrer: null, visitorId: "a" },
    { url: "https://example.com/", occurredAt: "2026-10-12T11:00:00Z", referrer: null, visitorId: "a" },
    { url: "https://example.com/?gad_campaignid=999", occurredAt: "2026-10-12T13:00:00Z", referrer: null, visitorId: "a" },
  ], at);
  const first = buildReport([row], { ...range, model: "first_touch" }, coverage);
  const last = buildReport([row], { ...range, model: "last_touch" }, coverage);
  const nonDirect = buildReport([row], range, coverage);
  assert.deepEqual(first.groups[0].campaignIds, { gad_campaignid: "111" });
  assert.equal(last.groups[0].source, "Direct");
  assert.deepEqual(nonDirect.groups[0].campaignIds, { hsa_cam: "222" });
  assert.equal(nonDirect.campaignConflictActivities, 0);
});
test("activity totals partition successful conversions, stage history and other activity with unchanged payment semantics", () => {
  const rows = [fact("form", "form", "received"), fact("call", "call", "completed"), fact("missed", "call", "missed"), fact("booking", "booking", "received"), fact("cancelled", "booking", "failed"), { ...fact("paid", "payment", "completed"), amountMinor: 100, currency: "USD" }, { ...fact("won", "stage_change", "completed"), amountMinor: 99999, currency: "USD" }, fact("stage", "stage_change", "received"), fact("note", "note", "received")];
  const r = buildReport(rows, range, coverage);
  assert.equal(r.totals.outcomes, 9);
  assert.equal(r.totals.conversions, 4);
  assert.equal(r.totals.stageChanges, 2);
  assert.equal(r.totals.otherActivities, 3);
  assert.equal(r.linkedConversions, 0);
  assert.equal(r.unlinkedConversions, 4);
  assert.deepEqual(r.totals.revenueByCurrency, { USD: 100 });
  rows[0].attribution = { status: "history_limited", evidence: "session_reference", touches: null };
  const partial = buildReport(rows, range, coverage);
  assert.equal(partial.partialHistories, 1);
  assert.equal(partial.coverage.limited, false);
  assert.equal(partial.totals.outcomes, 9);
});
test("standalone reports more than 1000 outcomes and 50 browsers, retaining stages, complete revenue and export facts", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-period-"));
  const store = openStore(join(dir, "test.sqlite"), "example", null, null, null);
  try {
    const sessions = Array.from({ length: 51 }, () => store.collect({ siteId: "example", visitorId: randomUUID(), eventId: randomUUID(), occurredAt: "2026-10-12T11:00:00Z", url: "https://example.com/?utm_source=google&utm_medium=ppc&gad_campaignid=123", referrer: null }, "https://example.com", at).visitorSessionId);
    for (let i = 0; i < 1001; i++) store.importOutcome({ ...fact(String(i), i % 2 ? "stage_change" : "form", "received"), visitorSessionId: sessions[i % sessions.length] }, at);
    const r = store.report(range, at).report;
    assert.equal(r.totals.outcomes, 1001);
    assert.equal(r.totals.conversions, 501);
    assert.equal(r.totals.stageChanges, 500);
    assert.equal(r.linkedConversions, 501);
    assert.equal(r.partialHistories, 0);
    assert.equal(r.coverage.limited, false);
    assert.equal(r.groups[0].source, "Google Ads");
    let cursor = null, count = 0;
    do { const page = store.exportOutcomes(cursor); count += page.records.length; cursor = page.nextCursor; } while (cursor);
    assert.equal(count, 1001);
    assert.equal(store.meta.list().deliveries.length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
