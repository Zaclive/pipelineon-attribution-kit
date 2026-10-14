(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || !script.dataset.site) return;
  var endpoint = new URL(script.src).origin;
  var site = script.dataset.site;
  var registry = window.OpenAttribution = window.OpenAttribution || { sites: {} };
  registry.sites = Object.assign(Object.create(null), registry.sites);
  if (registry.sites[site]) return;
  var storageKey = "oa:" + endpoint + ":" + site;
  var enabled = false;
  var generation = 0;
  var visitor = null;
  var context = null;
  var busy = false;
  var pending = false;
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

  function isClickIdParameter(name) {
    return CLICK_ID_KEYS.has(name.toLowerCase());
  }

  function isAttributionParameter(name) {
    const key = name.toLowerCase();
    return (
      (/^utm_[a-z0-9][a-z0-9_-]{0,59}$/.test(key) && !SENSITIVE_UTM_KEY.test(key)) ||
      CLICK_ID_KEYS.has(key) || AD_ID_KEYS.has(key) || AD_METADATA_KEYS.has(key)
    );
  }

  function containsCardLikeDigits(value) {
    return /(?:^|\D)(?:\d[ _-]*){13,19}(?!\d)/.test(value);
  }

  function safeAttributionParameter(name, value) {
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

  var privateValue = /[\x00-\x1f\x7f<>@]|(?:bearer\s|password|access_token|api_key|secret=)/i;
  function safeUrl(raw) {
    try {
      var input = new URL(raw);
      if (!/^https?:$/.test(input.protocol) || input.username || input.password) return null;
      var out = new URL(input.origin);
      out.pathname = input.pathname.split("/").map(function (part) {
        var value;
        try { value = decodeURIComponent(part); } catch (_) { return "redacted"; }
        return privateValue.test(value) || /^\+?\d[\d ().-]{8,}$/.test(value) ? "redacted" : part;
      }).join("/").slice(0, 1000);
      input.searchParams.forEach(function (value, name) {
        var key = name.toLowerCase();
        value = value.trim();
        if (safeAttributionParameter(key, value) && !privateValue.test(value) && !out.searchParams.has(key)) out.searchParams.set(key, value);
      });
      return out.href;
    } catch (_) { return null; }
  }
  function permitted() { return enabled && navigator.globalPrivacyControl !== true; }
  function getContext() { return permitted() && context ? { siteId: site, visitorSessionId: context } : null; }
  function consent(granted) {
    generation++;
    enabled = granted === true && navigator.globalPrivacyControl !== true;
    context = null;
    if (!enabled) {
      pending = false;
      visitor = null;
      try { localStorage.removeItem(storageKey); } catch (_) { /* Browser storage can be unavailable. */ }
      return;
    }
    try { visitor = localStorage.getItem(storageKey); } catch (_) { visitor = null; }
    if (!/^[0-9a-f-]{36}$/i.test(visitor || "")) visitor = crypto.randomUUID();
    try { localStorage.setItem(storageKey, visitor); } catch (_) { /* This visit remains memory-only. */ }
    track();
  }
  async function track() {
    if (!permitted() || !visitor) return;
    if (busy) { pending = true; return; }
    var url = safeUrl(location.href);
    if (!url) return;
    var epoch = generation;
    busy = true;
    try {
      var referrer = document.referrer ? new URL(document.referrer).origin : null;
      var response = await fetch(endpoint + "/v1/collect", { method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: site, visitorId: visitor,
          eventId: crypto.randomUUID(), occurredAt: new Date().toISOString(), url: url, referrer: referrer }) });
      if (!response.ok) return;
      var result = await response.json();
      if (generation !== epoch || !permitted()) return;
      if (typeof result.visitorSessionId === "string" && /^[0-9a-f-]{36}$/i.test(result.visitorSessionId)) {
        context = result.visitorSessionId;
        window.dispatchEvent(new CustomEvent("open-attribution:session", { detail: getContext() }));
      }
    } catch (_) { /* Tracking failure never prevents navigation or form submission. */ }
    finally { busy = false; if (pending) { pending = false; track(); } }
  }
  registry.sites[site] = { consent: consent, track: track, getTrackingContext: getContext };
  window.addEventListener("popstate", track);
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.attributionSite !== site) return;
    var input = form.querySelector('input[name="visitorSessionId"]');
    if (!input) { input = document.createElement("input"); input.type = "hidden"; input.name = "visitorSessionId"; form.appendChild(input); }
    input.value = getContext()?.visitorSessionId || "";
  }, true);
  if (script.dataset.consent === "granted") consent(true);
})();
