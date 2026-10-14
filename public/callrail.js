(function () {
  "use strict";
  if (window.PipelineOnCallRail) return;
  var configs = Object.create(null);
  var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function cookie(name, value) {
    document.cookie = name + "=" + encodeURIComponent(value) + "; Path=/; SameSite=Lax; Max-Age=" + (value ? "1800" : "0") + (location.protocol === "https:" ? "; Secure" : "");
  }
  function update(config) {
    var context = null;
    try {
      if (config.trackingConsent === true && navigator.globalPrivacyControl !== true) {
        context = config.kind === "pipelineon" ? window.PipelineOn?.getTrackingContext(config.key) : window.OpenAttribution?.sites[config.key]?.getTrackingContext();
      }
      var id = context && uuid.test(context.visitorSessionId) ? context.visitorSessionId : "";
      cookie(config.cookieName, id);
      cookie(config.cookieName + "_ads", id && config.advertisingConsent === true ? id : "");
      var saved = id && document.cookie.split(";").some(function (part) { return part.trim() === config.cookieName + "=" + id; });
      return { ready: !!saved, visitorSessionId: saved ? id : null };
    } catch (_) {
      try { cookie(config.cookieName, ""); cookie(config.cookieName + "_ads", ""); } catch (_ignored) {}
      return { ready: false, visitorSessionId: null };
    }
  }
  window.PipelineOnCallRail = {
    configure: function (config) {
      if (!config || !["pipelineon", "kit"].includes(config.kind) || typeof config.key !== "string" || !config.key || !/^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(config.cookieName)) return { ready: false, visitorSessionId: null };
      var old = configs[config.cookieName];
      if (old && (old.key !== config.key || old.kind !== config.kind)) return { ready: false, visitorSessionId: null };
      configs[config.cookieName] = { kind: config.kind, key: config.key, cookieName: config.cookieName,
        trackingConsent: config.trackingConsent === true, advertisingConsent: config.advertisingConsent === true };
      return update(configs[config.cookieName]);
    },
    refresh: function (cookieName) { return configs[cookieName] ? update(configs[cookieName]) : { ready: false, visitorSessionId: null }; },
    consent: function (cookieName, tracking, advertising) {
      var config = configs[cookieName];
      if (!config) return { ready: false, visitorSessionId: null };
      config.trackingConsent = tracking === true;
      config.advertisingConsent = advertising === true;
      return update(config);
    }
  };
  function refresh() { Object.keys(configs).forEach(function (name) { update(configs[name]); }); }
  window.addEventListener("pipelineon:session", refresh);
  window.addEventListener("open-attribution:session", refresh);
  window.addEventListener("pageshow", refresh);
  // A CMP must call consent() immediately on withdrawal. Polling also clears stale
  // references if the pixel is revoked independently or the browser enables GPC.
  window.setInterval(refresh, 1000);
})();
