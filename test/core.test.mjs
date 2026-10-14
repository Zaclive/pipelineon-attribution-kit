import { test } from "node:test";
import assert from "node:assert/strict";
import { safePage, buildTouches, validateOutcome, buildReport, reportRange, normalizeCall, trackingDoctor, formatMoney, timestamp } from "../core/index.mjs";
import { callRailAdapter } from "../examples/callrail-adapter.mjs";
const at = (day, hour) => `2026-10-${day}T${hour}:00:00.000Z`;
const range = { from: at("01", "00"), to: at("14", "00"), model: "last_non_direct" };
const coverage = { limited: false, inspected: 10, limit: 1000 };
function fact(overrides) {
  return validateOutcome({ externalId: "invoice-1", source: "crm", eventType: "payment", occurredAt: at("12", "14"), sourceUpdatedAt: at("12", "15"), outcome: "completed", amountMinor: 125050, currency: "USD", ...overrides });
}
function visits() {
  return [
    { id: "1", visitorId: "a", url: "https://example.com/?utm_source=google&utm_campaign=roof", occurredAt: at("10", "10"), referrer: null },
    { id: "2", visitorId: "a", url: "https://example.com/contact", occurredAt: "2026-10-10T10:02:00.000Z", referrer: "https://example.com/" },
    { id: "3", visitorId: "a", url: "https://example.com/?utm_source=facebook", occurredAt: at("11", "11"), referrer: null },
    { id: "4", visitorId: "a", url: "https://example.com/", occurredAt: at("12", "12"), referrer: null },
    { id: "5", visitorId: "a", url: "https://example.com/?utm_source=future", occurredAt: at("13", "12"), referrer: null },
  ];
}
test("privacy allowlist removes credentials, fragments and personal values", () => {
  const page = safePage("https://example.com/jane%40example.com?utm_source=google&utm_campaign=jane%40example.com&email=x&token=secret&fbclid=123#email");
  assert.deepEqual(page.parameters, { utm_source: "google", fbclid: "123" });
  assert.equal(page.url, "https://example.com/redacted?utm_source=google&fbclid=123");
  assert.equal(safePage("https://user:pass@example.com/"), null);
  assert.equal(safePage("javascript:alert(1)"), null);
});
test("first, last and non-direct use original time, ignore later visits, and retain internal source", () => {
  const touches = buildTouches(visits().reverse(), at("12", "14"));
  assert.equal(touches.firstTouch.sourceLabel, "google");
  assert.equal(touches.lastTouch.sourceLabel, "Direct");
  assert.equal(touches.lastNonDirectTouch.sourceLabel, "facebook");
  assert.equal(buildTouches(visits(), "2026-10-10T10:03:00Z").lastTouch.sourceLabel, "google");
});
test("custom UTMs and exact platform IDs survive without retaining encoded private values", () => {
  const tags = { utm_custom_audience: "homeowners", hsa_ad: "120213456789012345", utm_ad_id: "120213456789012346", gad_campaignid: "21155377610", dclid: "click-1", li_fat_id: "linkedin-click", utm_content: "x".repeat(512) };
  const raw = { ...tags, utm_email: "person", utm_token: "secret", utm_nested: "private%2540example.com", utm_credentials: "token%253Dsecret", utm_payment: "4111111111111111" };
  assert.deepEqual(safePage(`https://example.com/?${new URLSearchParams(raw)}`).parameters, tags);
});
test("source fields are never merged between touches", () => {
  const touches = buildTouches(visits(), at("12", "14"));
  assert.deepEqual(touches.lastNonDirectTouch.parameters, { utm_source: "facebook" });
});
test("revenue counts only completed payments, retains zero, and separates currencies", () => {
  const rows = [fact({}), fact({ externalId: "jpy", currency: "JPY", amountMinor: 125050 }), fact({ externalId: "zero", amountMinor: 0 }), fact({ externalId: "unknown", amountMinor: null, currency: null }), fact({ externalId: "call", eventType: "call" }), fact({ externalId: "failed", outcome: "failed" })];
  const report = buildReport(rows, range, coverage);
  assert.deepEqual(report.totals.revenueByCurrency, { USD: 125050, JPY: 125050 });
  assert.equal(report.totals.payments, 4);
  assert.equal(report.totals.unknownValuePayments, 1);
  assert.equal(formatMoney(125050, "JPY"), "¥125,050");
});
test("replays deduplicate, corrections and tombstones win, separate systems remain separate", () => {
  const initial = fact({});
  const corrected = fact({ amountMinor: 100, sourceUpdatedAt: at("13", "01") });
  assert.equal(buildReport([initial, initial, corrected], range, coverage).totals.revenueByCurrency.USD, 100);
  assert.equal(buildReport([corrected, initial], range, coverage).totals.revenueByCurrency.USD, 100);
  assert.equal(buildReport([initial, fact({ source: "other" })], range, coverage).totals.payments, 2);
  assert.equal(buildReport([initial, { ...corrected, deleted: true }], range, coverage).totals.payments, 0);
});
test("partial and ambiguous links are explicit and models do not double count", () => {
  const touches = buildTouches(visits(), at("12", "14"));
  const rows = [{ ...fact({}), attribution: { status: "linked", evidence: "session_reference", touches: { ...touches, historyLimited: true } } }, { ...fact({ externalId: "ambiguous" }), attribution: { status: "ambiguous", touches: null } }];
  const report = buildReport(rows, range, coverage);
  assert.equal(report.linkedOutcomes, 1);
  assert.equal(report.partialHistories, 1);
  assert.equal(report.groups.find(row => row.source === "facebook").payments, 1);
  assert.equal(buildReport(rows, { ...range, model: "first_touch" }, coverage).groups.find(row => row.source === "google").payments, 1);
  assert.equal(buildReport(rows, { ...range, model: "last_touch" }, coverage).groups.find(row => row.source === "Direct").payments, 1);
  assert.equal(report.medianHoursToPayment, 52);
});
test("reject malformed money, times, session references, and ranges", () => {
  assert.throws(() => timestamp("2026-02-30T12:00:00-05:00", "date"));
  assert.throws(() => timestamp("2026-10-12T24:00:00Z", "date"));
  assert.equal(timestamp("2024-02-29T12:00:00-05:00", "date"), "2024-02-29T17:00:00.000Z");
  for (const bad of [{ amountMinor: -1 }, { amountMinor: 1.5 }, { currency: "usd" }, { amountMinor: null }, { occurredAt: "yesterday" }, { occurredAt: at("13", "00") }, { visitorSessionId: "another-site" }]) assert.throws(() => fact(bad));
  assert.throws(() => reportRange({ ...range, from: "2025-01-01T00:00:00Z" }, at("14", "00")));
  assert.throws(() => reportRange({ ...range, model: "magic" }, at("14", "00")));
});
test("CallRail adapter rejects other accounts and incomplete calls, preserving original call time", () => {
  const payload = { id: "call1", company_id: "company1", start_time: at("10", "10"), answered: false, direction: "inbound" };
  const context = { accountId: "company1", sourceUpdatedAt: at("10", "11"), qualification: "unknown", visitorSessionId: null };
  const call = callRailAdapter(payload, context);
  assert.equal(call.status, "missed");
  assert.equal(call.occurredAt, payload.start_time);
  assert.throws(() => callRailAdapter({ ...payload, company_id: "company2" }, context));
  assert.throws(() => callRailAdapter({ ...payload, answered: undefined }, context));
  assert.throws(() => callRailAdapter({ ...payload, id: undefined }, context));
});
test("provider accounts cannot collide; answered calls never imply qualification or revenue", () => {
  const call = { provider: "callrail", accountId: "company1", callId: "call1", occurredAt: at("10", "10"), sourceUpdatedAt: at("10", "11"), status: "answered" };
  const a = normalizeCall(call);
  const b = normalizeCall({ ...call, accountId: "company2" });
  assert.notEqual(a.externalId, b.externalId);
  assert.equal(a.qualification, "unknown");
  assert.equal(a.amountMinor, null);
  assert.throws(() => normalizeCall({ ...call, revenue: 100 }));
});
test("empty diagnostics identify setup actions and never claim destination delivery", () => {
  const report = buildReport([], range, coverage);
  const doctor = trackingDoctor(report, { lastPageviewAt: null, taggedPageviews: 0, checkedAt: at("14", "00") });
  assert.equal(doctor.status, "needs_attention");
  assert.equal(doctor.checks.find(row => row.id === "destination").status, "unknown");
});
