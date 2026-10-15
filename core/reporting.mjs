import { KitError } from "./validation.mjs";
import { normalizeUtmParameters, campaignIdEvidence } from "./utm.mjs";
import { safePage } from "./tracking.mjs";
import { isClickIdParameter, safeAttributionParameter } from "./parameters.mjs";
function reportTouch(touch) {
  if (!touch) return null;
  const page = safePage(touch.url);
  if (!page) return null;
  const url = new URL(page.url);
  for (const key of [...url.searchParams.keys()]) if (isClickIdParameter(key)) url.searchParams.delete(key);
  const parameters = Object.fromEntries(Object.entries(touch.parameters ?? {})
    .filter(([key, value]) => !isClickIdParameter(key) && safeAttributionParameter(key, value)));
  return { url: url.href, referrer: safePage(touch.referrer)?.origin ?? null, occurredAt: touch.occurredAt,
    parameters, sourceLabel: touch.sourceLabel };
}
// Report-only classification preserves the original saved touch and traffic labels.
export function campaignEvidence(touch) {
  const p = normalizeUtmParameters(touch?.parameters ?? {});
  const { campaignIds, campaignConflict, campaignId, taxonomyId } = campaignIdEvidence(p);
  const campaign = p.utm_campaign || (campaignConflict ? "Conflicting campaign IDs" : campaignId ? `Campaign ID ${campaignId}` : taxonomyId ? `UTM ID ${taxonomyId}` : "");
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
export function isConversion(event) {
  return ["form", "call", "booking", "payment"].includes(event.eventType) && ["received", "completed"].includes(event.outcome);
}
function emptyTotals() {
  return { outcomes: 0, conversions: 0, stageChanges: 0, otherActivities: 0, calls: 0, missedCalls: 0, forms: 0, bookings: 0, qualifiedOutcomes: 0, payments: 0, unknownValuePayments: 0, revenueByCurrency: {}, deals: 0, unknownValueDeals: 0, dealValueByCurrency: {} };
}
function addDealValue(totals, value) {
  totals.deals++;
  if (value.amountMinor == null || value.currency == null) { totals.unknownValueDeals++; return; }
  const sum = (totals.dealValueByCurrency[value.currency] ?? 0) + value.amountMinor;
  if (!Number.isSafeInteger(sum)) throw new KitError("TOTAL_OVERFLOW", "Deal value total exceeds the safe integer range.", 422);
  totals.dealValueByCurrency[value.currency] = sum;
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
  const journeys = new Map();
  const statuses = Object.create(null);
  const evidenceCounts = Object.create(null);
  let linkedOutcomes = 0;
  let linkedConversions = 0;
  let campaignConflictActivities = 0;
  let partialHistories = 0;
  const lags = [];
  const activities = [];
  const selected = [...latest.values()].filter(row => !row.deleted && row.occurredAt &&
    Date.parse(row.occurredAt) >= Date.parse(range.from) && Date.parse(row.occurredAt) < Date.parse(range.to));
  // Assign each deal to its latest stage in the period, including that stage's
  // source. A deal moving through several stages or campaigns is counted once.
  const deals = new Map();
  for (const row of selected) {
    if (!row.dealValue || row.eventType !== "stage_change") continue;
    const key = JSON.stringify([row.source, row.dealValue.id]);
    const previous = deals.get(key);
    if (!previous || Date.parse(row.occurredAt) > Date.parse(previous.occurredAt) ||
      (Date.parse(row.occurredAt) === Date.parse(previous.occurredAt) && row.externalId > previous.externalId)) deals.set(key, row);
  }
  for (const row of selected) {
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
    const countedDeal = row.dealValue && deals.get(JSON.stringify([row.source, row.dealValue.id])) === row;
    if (countedDeal) { addDealValue(totals, row.dealValue); addDealValue(groups.get(key), row.dealValue); }
    // Explicit detail projection excludes raw CRM data, matching keys and visitor IDs.
    activities.push({ id: JSON.stringify([row.source, row.externalId]), groupId: key,
      source: row.source, externalId: row.externalId, eventType: row.eventType, occurredAt: row.occurredAt,
      outcome: row.outcome, label: row.label || row.eventType.replaceAll("_", " "), detail: row.detail || "",
      sourceUrl: row.sourceUrl || null, conversion: isConversion(row), linked: Boolean(touch),
      personId: attribution?.person?.id ?? null,
      status, evidence: attribution?.evidence ?? null, historyLimited: Boolean(touches?.historyLimited),
      amountMinor: row.amountMinor ?? null, currency: row.currency ?? null,
      dealValue: row.dealValue ? { ...row.dealValue, counted: Boolean(countedDeal) } : null,
      ...(row.dealValue && row.dealDetails ? { dealDetails: { name: row.dealDetails.name,
        contacts: row.dealDetails.contacts.map(contact => ({ name: contact.name, address: contact.address })) } } : {}),
      ...(row.dealValue && row.pipelineOnRecovery ? { pipelineOnRecovery: {
        recoveredAt: row.pipelineOnRecovery.recoveredAt, deliveredAt: row.pipelineOnRecovery.deliveredAt } } : {}),
      touch: reportTouch(touch) });
    if (status === "linked" && touches?.firstTouch) {
      const describe = value => value ? { source: campaignEvidence(value).source, campaign: campaignEvidence(value).campaign,
        campaignIds: campaignEvidence(value).campaignIds, campaignConflict: campaignEvidence(value).campaignConflict } : null;
      const journey = { first: describe(touches.firstTouch), last: describe(touches.lastTouch),
        lastNonDirect: describe(touches.lastNonDirectTouch) };
      const journeyKey = JSON.stringify(journey);
      if (!journeys.has(journeyKey)) journeys.set(journeyKey, { ...journey, activities: 0, conversions: 0 });
      journeys.get(journeyKey).activities++;
      if (isConversion(row)) journeys.get(journeyKey).conversions++;
    }
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
    journeys: [...journeys.values()].sort((a,b) => b.conversions - a.conversions || b.activities - a.activities).slice(0,100),
    journeysLimited: journeys.size > 100,
    groups: [...groups.values()].sort((a, b) => b.outcomes - a.outcomes || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign)),
    activities: activities.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id)),
    coverage, explanation: "All saved activities in the selected period by original event time. Conversions are received or completed forms, calls, bookings and payments; they are event counts, not unique customers or ad-platform conversions. Stage changes and unsuccessful or other activity are separate. Revenue is completed payments, grouped by currency. Deal value counts each deal once using its amount at the latest stage change in the period; it includes open, won and lost deals and is not collected revenue. Campaign IDs describe the selected touch, not a verified campaign name; conflicting IDs are retained without choosing a winner. Google referrals have no saved paid evidence and are not proof of organic traffic. Attribution describes evidence, not causation. Separate source systems are not automatically deduplicated. This is not an ad-platform delivery report." };
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
  check("campaign_conflicts", report.campaignConflictActivities ? "action" : "pass", "Campaign ID consistency", `${report.campaignConflictActivities} activities have disagreeing ad campaign IDs within the selected visit.`, "Compare gad_campaignid, hsa_cam and other ad campaign IDs in that visit's landing URL. Check stale tracking templates and redirects. A different campaign on a later visit is a separate touch, not this warning. UTM taxonomy IDs and numeric campaign names are kept separately; no winner is guessed.");
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
