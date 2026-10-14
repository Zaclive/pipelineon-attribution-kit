import { KitError } from "./validation.mjs";
// Report-only classification preserves the original saved touch and traffic labels.
function campaignEvidence(touch) {
  const p = touch?.parameters ?? {};
  const campaignIds = Object.fromEntries(["gad_campaignid", "hsa_cam", "gc_id", "utm_id", "utm_campaign_id", "campaign_id", "campaignid"]
    .filter(key => p[key]).map(key => [key, p[key]]));
  if (/^\d+$/.test(p.utm_campaign ?? "")) campaignIds.utm_campaign = p.utm_campaign;
  const values = [...new Set(Object.values(campaignIds))];
  const campaignConflict = values.length > 1;
  const campaign = p.utm_campaign || (campaignConflict ? "Conflicting campaign IDs" : values.length ? `Campaign ID ${values[0]}` : "");
  const utmSource = (p.utm_source ?? "").trim().toLowerCase();
  const googleHost = value => /^(?:[^.]+\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(value);
  const googleName = value => /^(?:google(?:[ _-]?ads)?|adwords)$/.test(value) || googleHost(value);
  let googleReferrer = false;
  try { googleReferrer = googleHost(new URL(touch?.referrer).hostname); } catch { /* No valid referrer evidence. */ }
  const googleClick = ["gclid", "dclid", "gbraid", "wbraid"].some(key => p[key]);
  const google = googleClick || Boolean(p.gad_campaignid || p.gc_id) || googleName(utmSource) || (!utmSource && (googleReferrer || googleName((touch?.sourceLabel ?? "").toLowerCase())));
  const googlePaid = google && (googleClick || ["gad_campaignid", "hsa_cam", "gc_id"].some(key => p[key]) || /^(?:cpc|ppc|paid|paidsearch|paid_search|paid-search|sem|display|cpm)$/.test((p.utm_medium ?? "").trim().toLowerCase()));
  const source = !touch ? "Unattributed" : googlePaid ? "Google Ads" : google
    ? (p.utm_medium?.toLowerCase() === "organic" ? "Google organic" : !utmSource && googleReferrer ? "Google referral" : "Google (unclassified)")
    : touch.sourceLabel;
  return { source, campaign, campaignIds, campaignConflict, groupId: JSON.stringify([source, campaign, campaignIds]) };
}
function isConversion(event) {
  return ["form", "call", "booking", "payment"].includes(event.eventType) && ["received", "completed"].includes(event.outcome);
}
function emptyTotals() {
  return { outcomes: 0, conversions: 0, stageChanges: 0, otherActivities: 0, calls: 0, missedCalls: 0, forms: 0, bookings: 0, qualifiedOutcomes: 0, payments: 0, unknownValuePayments: 0, revenueByCurrency: {} };
}
function addOutcome(totals, event) {
  totals.outcomes++;
  if (isConversion(event)) totals.conversions++;
  else if (event.eventType === "stage_change") totals.stageChanges++;
  else totals.otherActivities++;
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
  let linkedConversions = 0;
  let campaignConflictActivities = 0;
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
    if (touches?.historyLimited || status === "history_limited") partialHistories++;
    const touch = status !== "linked" ? null : range.model === "first_touch" ? touches?.firstTouch
      : range.model === "last_touch" ? touches?.lastTouch : touches?.lastNonDirectTouch ?? touches?.lastTouch;
    if (touch) linkedOutcomes++;
    if (touch && isConversion(row)) linkedConversions++;
    const campaign = campaignEvidence(touch);
    if (campaign.campaignConflict) campaignConflictActivities++;
    const key = campaign.groupId;
    if (!groups.has(key)) groups.set(key, { ...campaign, ...emptyTotals() });
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
    linkedConversions, unlinkedConversions: totals.conversions - linkedConversions, campaignConflictActivities,
    partialHistories, statuses, evidenceCounts, medianHoursToPayment: median, paymentLagSampleSize: lags.length,
    groups: [...groups.values()].sort((a, b) => b.outcomes - a.outcomes || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign)),
    coverage, explanation: "All saved activities in the selected period by original event time. Conversions are received or completed forms, calls, bookings and payments; they are event counts, not unique customers or ad-platform conversions. Stage changes and unsuccessful or other activity are separate. Revenue is completed payments, grouped by currency. Campaign IDs describe the selected touch, not a verified campaign name; conflicting IDs are retained without choosing a winner. Google referrals have no saved paid evidence and are not proof of organic traffic. Attribution describes evidence, not causation. Separate source systems are not automatically deduplicated. This is not an ad-platform delivery report." };
}
export function trackingDoctor(report, telemetry) {
  const checks = [];
  const check = (id, status, title, detail, action) => checks.push({ id, status, title, detail, action });
  check("traffic", telemetry.lastPageviewAt ? "pass" : "action", "Visit collection", telemetry.lastPageviewAt ? `Last observed visit: ${telemetry.lastPageviewAt}` : "No recorded visit was found.", "Visit a tagged landing page with tracking consent, then refresh.");
  check("source", telemetry.taggedPageviews > 0 ? "pass" : "unknown", "Advertising source", `${telemetry.taggedPageviews} tagged pageviews in the inspected sample.`, "Test with utm_source, utm_medium and utm_campaign; continue to a second page.");
  check("outcomes", report.totals.outcomes ? "pass" : "action", "Outcome ingestion", `${report.totals.outcomes} saved activities: ${report.totals.conversions} conversions, ${report.totals.stageChanges} stage changes, ${report.totals.otherActivities} other.`, "Import a real form, call, booking or payment using a stable source ID and original event time.");
  check("linkage", !report.totals.outcomes ? "unknown" : report.unlinkedOutcomes ? "action" : "pass", "Visit-to-outcome link", `${report.linkedOutcomes} linked; ${report.unlinkedOutcomes} unattributed.`, "Pass the accepted visitorSessionId with the form or call and keep it in the CRM outcome.");
  check("value", !report.totals.payments ? "unknown" : report.totals.unknownValuePayments ? "action" : "pass", "Payment value", `${report.totals.payments} completed payments; ${report.totals.unknownValuePayments} without a recorded amount.`, "Supply amountMinor and currency together. A call or won deal is not a payment.");
  check("coverage", report.coverage.limited || report.partialHistories ? "action" : "pass", "History coverage", report.coverage.limited ? "Outcome coverage is incomplete. Do not use these totals for budget decisions." : `Full saved activity totals. ${report.partialHistories} activities have incomplete visit history.`, "Use a narrower date range or export all source records before making budget decisions.");
  check("campaign_conflicts", report.campaignConflictActivities ? "action" : "pass", "Campaign ID consistency", `${report.campaignConflictActivities} activities have conflicting saved campaign IDs.`, "Check landing URL templates and CRM tracking parameters. No campaign ID is chosen when saved fields disagree.");
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
