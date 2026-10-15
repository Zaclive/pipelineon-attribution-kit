(function () {
  "use strict";
// BEGIN SHARED BROWSER SIGNATURE
async function collectBrowserSignature(permitted) {
  if (!permitted() || typeof navigator === "undefined" || navigator.globalPrivacyControl === true ||
      typeof crypto === "undefined" || !crypto.subtle || typeof TextEncoder === "undefined") return null;
  var values = {};
  try { values.environment = [navigator.userAgent, navigator.platform].join("|").slice(0,1024); } catch (_) {}
  try { values.screen = [window.screen.width, window.screen.height, window.screen.colorDepth, window.devicePixelRatio].join("|"); } catch (_) {}
  try { values.locale = [navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone].join("|"); } catch (_) {}
  try { values.capabilities = [navigator.hardwareConcurrency, navigator.maxTouchPoints].join("|"); } catch (_) {}
  try {
    var canvas = document.createElement("canvas"); canvas.width = 180; canvas.height = 40;
    var draw = canvas.getContext("2d");
    if (draw) {
      draw.fillStyle = "#e68"; draw.fillRect(3,2,100,25); draw.font = "16px Arial";
      draw.fillStyle = "#246"; draw.fillText("PipelineOn browser 1",7,23);
      values.canvas = canvas.toDataURL().slice(0,32768);
    }
  } catch (_) {}
  var gl = null;
  try {
    var surface = document.createElement("canvas"); surface.width = 1; surface.height = 1;
    gl = surface.getContext("webgl");
    if (gl) {
      var debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (debug) values.webgl = [gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_VERTEX_ATTRIBS)].join("|").slice(0,1024);
    }
  } catch (_) {} finally {
    try { var lose = gl && gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (_) {}
  }
  var timer;
  try {
    var work = Promise.all(Object.keys(values).filter(function (key) { return values[key] && !/^(?:undefined|null)?\|*$/.test(values[key]); }).map(async function (key) {
      var bytes = new TextEncoder().encode("po-browser-v1|" + key + "|" + values[key]);
      var digest = await crypto.subtle.digest("SHA-256", bytes);
      return [key, Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2,"0"); }).join("")];
    })).then(function (entries) { return { version: 1, components: Object.fromEntries(entries) }; });
    var result = await Promise.race([work, new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); },200); })]);
    return permitted() && navigator.globalPrivacyControl !== true ? result : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}
// END SHARED BROWSER SIGNATURE
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
  var pending = [];
  var navigationCleanup = null;
  var signaturePromise = null;
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

  // Recognize common SPA routes, not ordinary anchors or authentication fragments.
  function hashRoute(value) {
    if (typeof value !== "string" || value.length > 8192) return null;
    var match = /^(#!?)(\/(?!\/)[^#]*)/.exec(value);
    if (!match) return null;
    try {
      var url = new URL(match[2], "https://route.invalid");
      if (url.origin !== "https://route.invalid") return null;
      return { prefix: match[1], url };
    } catch { return null; }
  }

  // Hash routes receive the same bounded decoding and secret-path protection as
  // normal pages. Shared with the standalone pixel's unbundled implementation.
  function safeHashPath(pathname) {
    function decoded(value) {
      for (var round = 0; round < 4; round++) {
        try { value = decodeURIComponent(value); } catch { return null; }
        if (!/%[0-9a-f]{2}/i.test(value)) return value;
      }
      return null;
    }
    var parts = pathname.split("/");
    return parts.map(function (part, index) {
      if (!part) return part;
      var value = decoded(part);
      var previous = decoded(parts[index - 1] || "");
      if (value === null || /[\x00-\x1f\x7f<>@]/.test(value) ||
          /^(?:auth|authorization|code|confirm|credential|invite|magic|oauth|password|password-reset|payment|redeem|reset|secret|session|token|verification|verify)$/i.test(previous || "") ||
          !safeAttributionParameter("utm_route", value) ||
          (value.length >= 24 && /^[A-Za-z0-9._~-]+$/.test(value) &&
            (/^[a-f0-9]{24,}$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ||
              /[a-z]/i.test(value) && /\d/.test(value) && (value.match(/[-._~]/g) || []).length <= 1))) return "[redacted]";
      return part;
    }).join("/");
  }

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
      var route = hashRoute(input.hash);
      if (route) {
        route.url.pathname = safeHashPath(route.url.pathname);
        var safeRoute = safeUrl(route.url.href);
        if (safeRoute) {
          var routeUrl = new URL(safeRoute);
          out.hash = route.prefix.slice(1) + routeUrl.pathname + routeUrl.search;
        }
      }
      return out.href;
    } catch (_) { return null; }
  }
  function permitted() { return enabled && navigator.globalPrivacyControl !== true; }
  function getContext() { return permitted() && context ? { siteId: site, visitorSessionId: context } : null; }
    function observeNavigation(listener) {
      var history = window.history;
      if (!history) return function () {};
      var key = "__OPEN_ATTRIBUTION_NAVIGATION__";
      var shared = window[key];
      if (!shared) {
        shared = { listeners: [], methods: {} };
        window[key] = shared;
        var notify = function (event) {
          var pageUrl = event && typeof event.newURL === "string" ? event.newURL : location.href;
          shared.listeners.slice().forEach(function (callback) {
            try { callback(pageUrl, event && event.type); } catch (_e) {}
          });
        };
        ["pushState", "replaceState"].forEach(function (name) {
          var original = history[name];
          if (typeof original !== "function") return;
          var wrapped = function () {
            var result = original.apply(this, arguments);
            notify();
            return result;
          };
          try {
            history[name] = wrapped;
            if (history[name] === wrapped) shared.methods[name] = { original: original, wrapped: wrapped };
          } catch (_e) {}
        });
        shared.popstate = notify;
        window.addEventListener("popstate", notify);
        window.addEventListener("hashchange", notify);
      }
      shared.listeners.push(listener);
      return function () {
        var index = shared.listeners.indexOf(listener);
        if (index < 0) return;
        shared.listeners.splice(index, 1);
        if (shared.listeners.length) return;
        window.removeEventListener("popstate", shared.popstate);
        window.removeEventListener("hashchange", shared.popstate);
        Object.keys(shared.methods).forEach(function (name) {
          var method = shared.methods[name];
          try { if (history[name] === method.wrapped) history[name] = method.original; } catch (_e) {}
        });
        if (window[key] === shared) delete window[key];
      };
    }
  function navigationSnapshot(referrer, pageUrl) {
    return { url: safeUrl(pageUrl || location.href), referrer: referrer, occurredAt: new Date().toISOString() };
  }
  function consent(granted) {
    generation++;
    signaturePromise = null;
    if (navigationCleanup) { navigationCleanup(); navigationCleanup = null; }
    enabled = granted === true && navigator.globalPrivacyControl !== true;
    context = null;
    if (!enabled) {
      pending = [];
      visitor = null;
      try { localStorage.removeItem(storageKey); } catch (_) { /* Browser storage can be unavailable. */ }
      return;
    }
    try { visitor = localStorage.getItem(storageKey); } catch (_) { visitor = null; }
    if (!/^[0-9a-f-]{36}$/i.test(visitor || "")) visitor = crypto.randomUUID();
    try { localStorage.setItem(storageKey, visitor); } catch (_) { /* This visit remains memory-only. */ }
    var previousBase = location.pathname + location.search;
      var previousRoute = hashRoute(location.hash);
      var previousKey = previousBase + (previousRoute ? previousRoute.prefix + previousRoute.url.pathname + previousRoute.url.search : "");
    var previousPage = safeUrl(location.href);
    navigationCleanup = observeNavigation(function (pageUrl, navigationEvent) {
      if (!permitted()) return;
      var nextLocation = new URL(pageUrl || location.href);
      var nextBase = nextLocation.pathname + nextLocation.search;
      // Hash traversal also emits popstate. Its hashchange event carries the
      // exact destination, including when several native changes are queued.
      if (navigationEvent === "popstate" && nextBase === previousBase) return;
      var nextRoute = hashRoute(nextLocation.hash);
      // Ordinary section links do not turn a hash route into a new base page.
      if (nextBase === previousBase && !nextRoute && nextLocation.hash) return;
      var nextKey = nextBase + (nextRoute ? nextRoute.prefix + nextRoute.url.pathname + nextRoute.url.search : "");
      if (nextKey === previousKey) return;
      previousKey = nextKey;
      previousBase = nextBase;
      var page = navigationSnapshot(previousPage, pageUrl);
      previousPage = page.url;
      track(page);
    });
    track();
  }
  async function track(pageSnapshot) {
    if (!permitted() || !visitor) return;
    var page = pageSnapshot || navigationSnapshot(document.referrer ? new URL(document.referrer).origin : null);
    if (!page.url) return;
    if (busy) { if (pending.length < 50) pending.push(page); return; }
    var epoch = generation;
    busy = true;
    try {
      if (!signaturePromise) signaturePromise = collectBrowserSignature(function () { return permitted() && script.dataset.poBrowserContinuity !== "off"; });
      var signature = await signaturePromise;
      if (generation !== epoch || !permitted()) return;
      var response = await fetch(endpoint + "/v1/collect", { method: "POST", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteId: site, visitorId: visitor,
          eventId: crypto.randomUUID(), browserSignature: context ? undefined : signature || undefined, occurredAt: page.occurredAt, url: page.url, referrer: page.referrer }) });
      if (!response.ok) return;
      var result = await response.json();
      if (generation !== epoch || !permitted()) return;
      if (typeof result.visitorSessionId === "string" && /^[0-9a-f-]{36}$/i.test(result.visitorSessionId)) {
        context = result.visitorSessionId;
        window.dispatchEvent(new CustomEvent("open-attribution:session", { detail: getContext() }));
      }
    } catch (_) { /* Tracking failure never prevents navigation or form submission. */ }
    finally { busy = false; if (permitted() && pending.length) track(pending.shift()); }
  }
  registry.sites[site] = { consent: consent, track: function () { return track(); }, getTrackingContext: getContext };
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement) || form.dataset.attributionSite !== site) return;
    var input = form.querySelector('input[name="visitorSessionId"]');
    if (!input) { input = document.createElement("input"); input.type = "hidden"; input.name = "visitorSessionId"; form.appendChild(input); }
    input.value = getContext()?.visitorSessionId || "";
  }, true);
  if (script.dataset.consent === "granted") consent(true);
})();
