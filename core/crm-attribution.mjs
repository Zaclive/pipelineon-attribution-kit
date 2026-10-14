import { normalizeUtmParameters, campaignIdEvidence } from "./utm.mjs";
import { KitError } from "./validation.mjs";

// Ten custom text properties; no dependency on paid CRM workflows. These are
// PipelineOn fields, never HubSpot's automatically managed source drill-downs.
export const HUBSPOT_ATTRIBUTION_PROPERTIES = [
  "po_first_utm_source", "po_first_utm_medium", "po_first_utm_campaign", "po_first_campaign_id",
  "po_last_utm_source", "po_last_utm_medium", "po_last_utm_campaign", "po_last_campaign_id",
  "po_attribution", "po_visitor_session_id",
];
function snapshot(touch) {
  if (!touch) return null;
  const p = normalizeUtmParameters(touch.parameters ?? {});
  const { campaignIds, campaignId, campaignConflict, taxonomyId } = campaignIdEvidence(p);
  // Contact properties intentionally exclude click IDs, URLs and visitor IPs.
  const utms = Object.fromEntries(Object.entries(p).filter(([key]) => /^utm_(?:source|medium|campaign|term|content|id)$/.test(key)));
  const rawUtms = Object.fromEntries(Object.entries(touch.parameters ?? {}).filter(([key]) => Object.hasOwn(utms,key)));
  return { occurredAt: touch.occurredAt, source: p.utm_source || touch.sourceLabel, utms, rawUtms, campaignIds, campaignId, campaignConflict, taxonomyId };
}
function fields(prefix, touch) {
  return { [`po_${prefix}_utm_source`]: touch?.utms.utm_source || touch?.source || "",
    [`po_${prefix}_utm_medium`]: touch?.utms.utm_medium || "",
    [`po_${prefix}_utm_campaign`]: touch?.utms.utm_campaign || "",
    [`po_${prefix}_campaign_id`]: touch?.campaignId || "" };
}
/** Pure mapping only. Caller must load the existing contact, serialize writes per
 * contact, validate the session/site and cutoff, then persist a delivery receipt.
 * An older/out-of-order submission never replaces newer latest-touch evidence.
 */
export function hubspotAttributionProperties(touches, existing, visitorSessionId) {
  let prior = null;
  if (existing.po_attribution) {
    try { prior = JSON.parse(existing.po_attribution); } catch { throw new KitError("CRM_ATTRIBUTION_INVALID", "Existing attribution is not valid JSON.", 409); }
    if (prior?.version !== 1 || !prior.first || !prior.last || !Number.isFinite(Date.parse(prior.last.occurredAt)))
      throw new KitError("CRM_ATTRIBUTION_INVALID", "Existing attribution has an unsupported shape.", 409);
  }
  const first = snapshot(touches.firstTouch), last = snapshot(touches.lastTouch), lastNonDirect = snapshot(touches.lastNonDirectTouch);
  if (!first || !last) return {};
  if (prior && Date.parse(prior.last.occurredAt) > Date.parse(last.occurredAt)) return {};
  if (prior && Date.parse(prior.last.occurredAt) === Date.parse(last.occurredAt) && JSON.stringify(prior.last) !== JSON.stringify(last))
    throw new KitError("CRM_ATTRIBUTION_CONFLICT", "Different latest-touch evidence has the same event time. Review before updating.", 409);
  const hasOriginal = prior || Object.keys(fields("first", first)).some(key => existing[key]);
  // Existing original fields are one protected snapshot; never fill its blanks
  // from another campaign. Retain the original JSON evidence across submissions.
  const timeline = new Map();
  for (const item of [...(prior?.timeline ?? []), ...(touches.timeline ?? [touches.firstTouch, touches.lastNonDirectTouch, touches.lastTouch]).filter(Boolean).map(snapshot)]) {
    if (item) timeline.set(JSON.stringify([item.occurredAt, item.source, item.utms, item.campaignIds]), item);
  }
  const allTouches = [...timeline.values()].sort((a,b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const evidence = { version: 1, first: prior?.first ?? (hasOriginal ? null : first), last,
    lastNonDirect: lastNonDirect ?? prior?.lastNonDirect ?? null,
    timeline: allTouches.slice(-50), historyLimited: touches.historyLimited === true || prior?.historyLimited === true || allTouches.length > 50 };
  if (hasOriginal && !prior) throw new KitError("CRM_ATTRIBUTION_PARTIAL", "Original CRM fields exist without their evidence snapshot. Review the mapping before updating.", 409);
  const encoded = JSON.stringify(evidence);
  if (encoded.length > 60000) throw new KitError("CRM_ATTRIBUTION_TOO_LARGE", "Attribution exceeds the CRM text limit.", 422);
  return { ...(hasOriginal ? {} : fields("first", first)), ...fields("last", last),
    po_attribution: encoded, po_visitor_session_id: visitorSessionId };
}
