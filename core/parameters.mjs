// Campaign parameter policy. Browser copies are verified by contract tests.
// Shared by ingestion and reporting. Keep the standalone pixel implementations
// in sync; pixelLoaderSafety.test.ts exercises their output through ingestion.
const CLICK_ID_KEYS = new Set([
  "gclid", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "twclid", "yclid", "li_fat_id",
]);
const AD_ID_KEYS = new Set([
  "gad_campaignid", "hsa_acc", "hsa_cam", "hsa_grp", "hsa_ad",
  "campaign_id", "adset_id", "adgroup_id", "ad_id",
  "campaignid", "adsetid", "adgroupid", "adid",
  "h_ad_id", "fbc_id", "gc_id", "creative",
]);
const AD_METADATA_KEYS = new Set([
  "gad_source", "hsa_net", "hsa_src", "hsa_mt", "hsa_tgt", "hsa_kw", "hsa_ver", "hsa_la", "hsa_ol",
  "g_special_campaign", "keyword", "matchtype", "network", "device",
]);
const SENSITIVE_UTM_KEY = /(?:^|[_-])(?:email|phone|address|first[_-]?name|last[_-]?name|password|pwd|token|auth|authorization|secret|credential|jwt|csrf|xsrf|session|sessionid|ssn|card|credit[_-]?card|cvv|cvc|iban|bank|account[_-]?number|api[_-]?key|private[_-]?key)(?:$|[_-])/i;

export function isClickIdParameter(name) {
  return CLICK_ID_KEYS.has(name.toLowerCase());
}

export function isAttributionParameter(name) {
  const key = name.toLowerCase();
  return (
    (/^utm_[a-z0-9][a-z0-9_-]{0,59}$/.test(key) && !SENSITIVE_UTM_KEY.test(key)) ||
    CLICK_ID_KEYS.has(key) || AD_ID_KEYS.has(key) || AD_METADATA_KEYS.has(key)
  );
}

function containsCardLikeDigits(value) {
  return /(?:^|\D)(?:\d[ _-]*){13,19}(?!\d)/.test(value);
}

export function safeAttributionParameter(name, value) {
  const key = name.toLowerCase();
  if (!isAttributionParameter(key) || !value || value.length > 512) return false;
  // Meta's numeric IDs often have the same length as payment-card numbers.
  // Only explicit ID fields get this exception, never arbitrary UTM content.
  if ((AD_ID_KEYS.has(key) || key === "utm_id" || /^utm_.+_id$/.test(key)) && /^[0-9]+$/.test(value)) return value.length <= 32;
  let decoded = value;
  for (let round = 0; round < 4; round += 1) {
    if (/[\x00-\x1f\x7f]/.test(decoded) ||
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(decoded) ||
      containsCardLikeDigits(decoded) ||
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(decoded) ||
      /(?:^|[^a-z0-9])(?:access_token|auth|authorization|code|credential|cvv|cvc|oauth|password|payment|refresh_token|reset|secret|session|token)=/i.test(decoded)) return false;
    if (!/%[0-9a-f]{2}/i.test(decoded)) return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return true;
      decoded = next;
    } catch {
      return false;
    }
  }
  return false;
}
