import { timestamp } from "./primitives.mjs";
import { safeAttributionParameter } from "./parameters.mjs";
import { normalizeUtmParameters } from "./utm.mjs";
import { hashRoute, safeHashPath } from "./hash-route.mjs";
const PRIVATE_VALUE = /[\x00-\x1f\x7f<>@]|(?:bearer\s|password|access_token|api_key|secret=)/i;
export function safePage(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const parameters = {};
    for (const [rawKey, rawValue] of url.searchParams) {
      const key = rawKey.toLowerCase();
      const cleaned = rawValue.trim();
      if (safeAttributionParameter(key, cleaned) && !PRIVATE_VALUE.test(cleaned) && !Object.hasOwn(parameters, key)) parameters[key] = cleaned;
    }
    const clean = new URL(url.origin);
    clean.pathname = url.pathname.split("/").map(part => {
      let decoded;
      try { decoded = decodeURIComponent(part); } catch { return "redacted"; }
      return PRIVATE_VALUE.test(decoded) || /^\+?\d[\d ().-]{8,}$/.test(decoded) ? "redacted" : part;
    }).join("/").slice(0, 1000);
    for (const [key, val] of Object.entries(parameters)) clean.searchParams.set(key, val);
    const route = hashRoute(url.hash);
    if (route) {
      route.url.pathname = safeHashPath(route.url.pathname);
      const safeRoute = safePage(route.url.href);
      if (safeRoute) {
        const parsedRoute = new URL(safeRoute.url);
        clean.hash = `${route.prefix.slice(1)}${parsedRoute.pathname}${parsedRoute.search}`;
        for (const [key, value] of Object.entries(safeRoute.parameters)) {
          if (!Object.hasOwn(parameters, key)) parameters[key] = value;
        }
      }
    }
    return { url: clean.href, origin: clean.origin, parameters };
  } catch { return null; }
}
function referrerOrigin(value, pageOrigin) {
  const page = safePage(value);
  if (!page) return null;
  return new URL(page.origin).hostname.replace(/^www\./, "") === new URL(pageOrigin).hostname.replace(/^www\./, "") ? null : page.origin;
}
function sourceLabel(parameters, referrer) {
  if (parameters.utm_source && parameters.utm_source !== "direct") return parameters.utm_source;
  if (parameters.gclid || parameters.gbraid || parameters.wbraid || parameters.gc_id) return "Google";
  if (parameters.fbclid || parameters.fbc_id) return "Facebook";
  if (parameters.msclkid) return "Microsoft";
  if (parameters.ttclid) return "TikTok";
  if (parameters.utm_source === "direct") return referrer ? new URL(referrer).hostname : "Direct";
  if (Object.keys(parameters).length) return "Tagged campaign";
  return referrer ? new URL(referrer).hostname : "Direct";
}
export function buildTouches(observations, cutoffAt) {
  const cutoff = Date.parse(timestamp(cutoffAt, "cutoffAt"));
  const result = { timeline: [], firstTouch: null, lastTouch: null, lastNonDirectTouch: null, historyLimited: false };
  const prior = new Map();
  const sorted = observations.filter(row => Number.isFinite(Date.parse(row.occurredAt)) && Date.parse(row.occurredAt) <= cutoff)
    .slice().sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  for (const row of sorted) {
    const page = safePage(row.url);
    if (!page) continue;
    const referrer = referrerOrigin(row.referrer, page.origin);
    const normalizedParameters = normalizeUtmParameters(page.parameters);
    const signature = JSON.stringify(Object.entries(normalizedParameters).sort(([a], [b]) => a.localeCompare(b)));
    const id = row.visitorId ?? "unknown";
    const previous = prior.get(id);
    const at = Date.parse(row.occurredAt);
    const newVisit = !previous || at - previous.at >= 1800000;
    const newSource = signature !== "[]" ? signature !== previous?.signature : referrer !== null && referrer !== previous?.referrer;
    prior.set(id, { at, signature: newVisit || newSource ? signature : previous.signature, referrer: newVisit || newSource ? referrer : previous.referrer });
    if (!newVisit && !newSource) continue;
    const touch = { url: page.url, referrer, occurredAt: new Date(at).toISOString(), visitorId: row.visitorId ?? null,
      parameters: page.parameters, normalizedParameters, sourceLabel: sourceLabel(normalizedParameters, referrer) };
    result.timeline.push(touch);
    result.firstTouch ??= touch;
    result.lastTouch = touch;
    if (touch.sourceLabel !== "Direct") result.lastNonDirectTouch = touch;
  }
  return result;
}
