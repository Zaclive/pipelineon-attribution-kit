import { KitError } from "./validation.mjs";
function emptyTotals() {
  return { outcomes: 0, calls: 0, missedCalls: 0, forms: 0, bookings: 0, qualifiedOutcomes: 0, payments: 0, unknownValuePayments: 0, revenueByCurrency: {} };
}
function addOutcome(totals, event) {
  totals.outcomes++;
  if (event.eventType === "call") { totals.calls++; if (event.outcome === "missed") totals.missedCalls++; }
  if (event.eventType === "form") totals.forms++;
  if (event.eventType === "booking" && ["completed", "received"].includes(event.outcome)) totals.bookings++;
  if (event.qualification === "qualified") totals.qualifiedOutcomes++;
  if (event.eventType !== "payment" || event.outcome !== "completed") return;
  totals.payments++;
  if (event.amountMinor == null || event.currency == null) { totals.unknownValuePayments++; return; }
  const sum = (totals.revenueByCurrency[event.currency] ?? 0) + event.amountMinor;
  if (!Number.isSafeInteger(sum)) throw new KitError("TOTAL_OVERFLOW", "Revenue total exceeds the safe integer range.", 422);
  totals.revenueByCurrency[event.currency] = sum;
}
/** Source-scoped deduplication only. Independent systems may report the same sale. */
export function buildReport(rows, range, coverage) {
  const latest = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.source, row.externalId]);
    const previous = latest.get(key);
    if (!previous || Date.parse(row.sourceUpdatedAt) > Date.parse(previous.sourceUpdatedAt)) latest.set(key, row);
  }
  const totals = emptyTotals();
  const groups = new Map();
  const statuses = Object.create(null);
  const evidenceCounts = Object.create(null);
  let linkedOutcomes = 0;
  let partialHistories = 0;
  const lags = [];
  for (const row of latest.values()) {
    if (row.deleted || !row.occurredAt || Date.parse(row.occurredAt) < Date.parse(range.from) || Date.parse(row.occurredAt) >= Date.parse(range.to)) continue;
    addOutcome(totals, row);
    const attribution = row.attribution;
    const status = attribution?.status ?? "unlinked";
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (attribution?.evidence) evidenceCounts[attribution.evidence] = (evidenceCounts[attribution.evidence] ?? 0) + 1;
    const touches = attribution?.touches;
    if (touches?.historyLimited) partialHistories++;
    const touch = status !== "linked" ? null : range.model === "first_touch" ? touches?.firstTouch
      : range.model === "last_touch" ? touches?.lastTouch : touches?.lastNonDirectTouch ?? touches?.lastTouch;
    if (touch) linkedOutcomes++;
    const source = touch?.sourceLabel ?? "Unattributed";
    const campaign = touch?.parameters?.utm_campaign ?? "";
    const key = JSON.stringify([source, campaign]);
    if (!groups.has(key)) groups.set(key, { source, campaign, ...emptyTotals() });
    addOutcome(groups.get(key), row);
    if (touches?.firstTouch && status === "linked" && row.eventType === "payment" && row.outcome === "completed") {
      const hours = (Date.parse(row.occurredAt) - Date.parse(touches.firstTouch.occurredAt)) / 3600000;
      if (Number.isFinite(hours) && hours >= 0) lags.push(hours);
    }
  }
  lags.sort((a, b) => a - b);
  const midpoint = Math.floor(lags.length / 2);
  const median = !lags.length ? null : lags.length % 2 ? lags[midpoint] : (lags[midpoint - 1] + lags[midpoint]) / 2;
  return { version: 1, ...range, totals, linkedOutcomes, unlinkedOutcomes: totals.outcomes - linkedOutcomes,
    partialHistories, statuses, evidenceCounts, medianHoursToPayment: median, paymentLagSampleSize: lags.length,
    groups: [...groups.values()].sort((a, b) => b.outcomes - a.outcomes || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign)),
    coverage, explanation: "Observed outcomes by original event time. Revenue is completed payments, grouped by currency. Attribution describes evidence, not causation. Separate source systems are not automatically deduplicated. This is not an ad-platform delivery report." };
}
export function trackingDoctor(report, telemetry) {
  const checks = [];
  const check = (id, status, title, detail, action) => checks.push({ id, status, title, detail, action });
  check("traffic", telemetry.lastPageviewAt ? "pass" : "action", "Visit collection", telemetry.lastPageviewAt ? `Last observed visit: ${telemetry.lastPageviewAt}` : "No recorded visit was found.", "Visit a tagged landing page with tracking consent, then refresh.");
  check("source", telemetry.taggedPageviews > 0 ? "pass" : "unknown", "Advertising source", `${telemetry.taggedPageviews} tagged pageviews in the inspected sample.`, "Test with utm_source, utm_medium and utm_campaign; continue to a second page.");
  check("outcomes", report.totals.outcomes ? "pass" : "action", "Outcome ingestion", `${report.totals.outcomes} outcomes in this period.`, "Import a real form, call, booking or payment using a stable source ID and original event time.");
  check("linkage", !report.totals.outcomes ? "unknown" : report.unlinkedOutcomes ? "action" : "pass", "Visit-to-outcome link", `${report.linkedOutcomes} linked; ${report.unlinkedOutcomes} unattributed.`, "Pass the accepted visitorSessionId with the form or call and keep it in the CRM outcome.");
  check("value", !report.totals.payments ? "unknown" : report.totals.unknownValuePayments ? "action" : "pass", "Payment value", `${report.totals.payments} completed payments; ${report.totals.unknownValuePayments} without a recorded amount.`, "Supply amountMinor and currency together. A call or won deal is not a payment.");
  check("coverage", report.coverage.limited || report.partialHistories ? "action" : "pass", "History coverage", report.coverage.limited ? "This is a bounded sample, not a complete report." : `${report.partialHistories} outcomes have incomplete visit history.`, "Use a narrower date range or export all source records before making budget decisions.");
  check("destination", "unknown", "Ad-platform delivery", "This attribution report does not inspect delivery receipts.", "Open Meta delivery status to inspect acknowledgements and failed attempts. Verify any other destinations separately.");
  return { checks, checkedAt: telemetry.checkedAt, status: checks.some(row => row.status === "action") ? "needs_attention" : "observed", explanation: "These checks inspect saved evidence. A pass does not prove a fresh end-to-end installation test or permission to contact a visitor." };
}
export function formatMoney(amount, currency) {
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amount / (10 ** digits));
  } catch { return `${amount} minor units (${currency})`; }
}
