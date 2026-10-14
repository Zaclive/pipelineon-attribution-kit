// This function is embedded in each standalone pixel by sync-browser-diagnostics.mjs.
// Only call after tracking consent. No requests, storage, identifiers or fingerprinting.
export function collectBrowserDiagnostics(browserWindow, browserDocument, browserNavigator) {
  var result = { version: 1, webdriver: false, adBlockStatus: "unknown" };
  var control = null;
  var bait = null;
  try { result.webdriver = browserNavigator.webdriver === true; } catch (_) {}
  try {
    if (!browserDocument.body || typeof browserWindow.getComputedStyle !== "function") return result;
    function probe(className) {
      var node = browserDocument.createElement("div");
      node.className = className;
      node.setAttribute("aria-hidden", "true");
      node.style.cssText = "position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none;";
      return node;
    }
    function hidden(node) {
      var style = browserWindow.getComputedStyle(node);
      return style.display === "none" || style.visibility === "hidden" || node.offsetWidth === 0 || node.offsetHeight === 0;
    }
    control = probe("po-diagnostic-control");
    bait = probe("adsbox ad-banner adsbygoogle");
    browserDocument.body.appendChild(control);
    browserDocument.body.appendChild(bait);
    // If CSS/CSP or an unrendered document also hides the control, the result is inconclusive.
    if (!hidden(control)) result.adBlockStatus = hidden(bait) ? "detected" : "not_detected";
  } catch (_) {
    result.adBlockStatus = "unknown";
  } finally {
    [control, bait].forEach(function (node) {
      try { if (node && node.parentNode) node.parentNode.removeChild(node); } catch (_) {}
    });
  }
  return result;
}
