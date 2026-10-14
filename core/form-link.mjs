// Match a confirmed CRM submission to first-party browser evidence. Identity
// keys are supplied by the trusted adapter; never put an API token in a pixel.
export function formIdentityEmails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const emails = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!/(^|_)(email|email_address|e_mail)$/.test(key.toLowerCase())) continue;
    for (const item of Array.isArray(raw) ? raw.slice(0, 5) : [raw]) {
      if (typeof item !== "string") continue;
      const email = item.trim().toLowerCase();
      if (email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emails.push(email);
    }
  }
  return [...new Set(emails)];
}
function pageKey(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.hostname.toLowerCase().replace(/^www\./, "") + (url.port ? ":" + url.port : "") + url.pathname;
  } catch { return null; }
}
export function matchFormVisit(form, observations) {
  const page = pageKey(form.url), at = Date.parse(form.occurredAt);
  if (!form.identityKey || !page || !Number.isFinite(at)) return { status: "unlinked", observationId: null, visitorSessionId: null };
  const candidates = observations.filter(row => row.siteId === form.siteId && row.identityKeys.length === 1 &&
    row.identityKeys[0] === form.identityKey && row.visitorSessionId && pageKey(row.url) === page &&
    Math.abs(Date.parse(row.occurredAt) - at) <= 120000);
  const sessions = new Set(candidates.map(row => row.visitorSessionId));
  if (sessions.size !== 1) return { status: sessions.size ? "ambiguous" : "unlinked", observationId: null, visitorSessionId: null };
  candidates.sort((a, b) => Math.abs(Date.parse(a.occurredAt) - at) - Math.abs(Date.parse(b.occurredAt) - at) || a.id.localeCompare(b.id));
  return { status: "linked", observationId: candidates[0].id, visitorSessionId: candidates[0].visitorSessionId };
}
