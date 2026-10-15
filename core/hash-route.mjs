import { safeAttributionParameter } from "./parameters.mjs";

// Recognize common SPA routes, not ordinary anchors or authentication fragments.
export function hashRoute(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  const match = /^(#!?)(\/(?!\/)[^#]*)/.exec(value);
  if (!match) return null;
  try {
    const url = new URL(match[2], "https://route.invalid");
    if (url.origin !== "https://route.invalid") return null;
    return { prefix: match[1], url };
  } catch { return null; }
}

// Hash routes receive the same bounded decoding and secret-path protection as
// normal pages. Shared with the standalone pixel's unbundled implementation.
export function safeHashPath(pathname) {
  function decoded(value) {
    for (let round = 0; round < 4; round++) {
      try { value = decodeURIComponent(value); } catch { return null; }
      if (!/%[0-9a-f]{2}/i.test(value)) return value;
    }
    return null;
  }
  const parts = pathname.split("/");
  return parts.map((part, index) => {
    if (!part) return part;
    const value = decoded(part);
    const previous = decoded(parts[index - 1] || "");
    if (value === null || /[\x00-\x1f\x7f<>@]/.test(value) ||
        /^(?:auth|authorization|code|confirm|credential|invite|magic|oauth|password|password-reset|payment|redeem|reset|secret|session|token|verification|verify)$/i.test(previous || "") ||
        !safeAttributionParameter("utm_route", value) ||
        (value.length >= 24 && /^[A-Za-z0-9._~-]+$/.test(value) &&
          (/^[a-f0-9]{24,}$/i.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ||
            /[a-z]/i.test(value) && /\d/.test(value) && (value.match(/[-._~]/g) || []).length <= 1))) return "[redacted]";
    return part;
  }).join("/");
}
