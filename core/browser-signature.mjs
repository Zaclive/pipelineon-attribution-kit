// Embedded verbatim in all pixels by scripts/sync-browser-signature.mjs.
// No external agent, storage, microphone, font enumeration or network request.
export async function collectBrowserSignature(permitted) {
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
