import { safeAttributionParameter } from "./parameters.mjs";

// Derived reporting values only. Never rewrite the saved URL or merge visits.
export function normalizeUtmParameters(parameters) {
  const result = {};
  for (const [name, raw] of Object.entries(parameters)) {
    const key = name.toLowerCase();
    if (typeof raw !== "string" || !safeAttributionParameter(key, raw)) continue;
    let value = raw.trim();
    if (!value || /^(?:\{.*\}|\[.*\]|not set|undefined|null|unknown)$/i.test(value)) continue;
    if (key === "utm_source" || key === "utm_medium") value = value.toLowerCase();
    if (key === "utm_source") {
      if (value === "(direct)") value = "direct";
      if (/^(?:google(?:[ _-]?ads)?|adwords|(?:www\.)?google\.com)$/.test(value)) value = "google";
      if (/^(?:fb|facebook|(?:www\.)?facebook\.com)$/.test(value)) value = "facebook";
    }
    if (key === "utm_medium") {
      if (/^(?:ppc|cpc|paid[ _-]?search)$/.test(value)) value = "cpc";
      if (/^paid[ _-]?social$/.test(value)) value = "paid_social";
    }
    if (!Object.hasOwn(result, key)) result[key] = value;
  }
  return result;
}

export function campaignIdEvidence(parameters) {
  const p = normalizeUtmParameters(parameters);
  // UTM IDs belong to the advertiser's taxonomy; numeric campaign names are
  // still names. Neither is automatically the ad network's campaign ID.
  const campaignIds = Object.fromEntries(["gad_campaignid", "hsa_cam", "gc_id", "utm_id", "utm_campaign_id", "campaign_id", "campaignid"]
    .filter(key => p[key]).map(key => [key, p[key]]));
  const networkIds = Object.fromEntries(Object.entries(campaignIds).filter(([key]) => !["utm_id", "utm_campaign_id"].includes(key)));
  const values = [...new Set(Object.values(networkIds))];
  const campaignConflict = values.length > 1;
  const campaignId = campaignConflict ? null : values[0] ?? null;
  return { campaignIds, campaignConflict, campaignId, taxonomyId: p.utm_id ?? p.utm_campaign_id ?? null };
}
