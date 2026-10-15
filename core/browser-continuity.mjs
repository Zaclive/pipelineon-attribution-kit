// Diagnostic browser continuity only. Never creates person links or conversion credit.
export const SIGNATURE_COMPONENTS = Object.freeze({ environment: 2, screen: 1, locale: 1, capabilities: 1, canvas: 3, webgl: 3 });
export const CONTINUITY_DAYS = 30;
export function normalizeBrowserSignature(input) {
  if (!input || typeof input !== "object" || input.version !== 1 || !input.components || typeof input.components !== "object") return null;
  const components = {};
  for (const key of Object.keys(SIGNATURE_COMPONENTS)) {
    const value = input.components[key];
    if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) components[key] = value;
  }
  return Object.keys(components).length ? { version: 1, components } : null;
}
export function compareBrowserSignatures(current, previous) {
  const a = normalizeBrowserSignature(current), b = normalizeBrowserSignature(previous);
  const matched = [], changed = [], unavailable = [];
  let score = 0;
  for (const [key, weight] of Object.entries(SIGNATURE_COMPONENTS)) {
    if (!a?.components[key] || !b?.components[key]) unavailable.push(key);
    else if (a.components[key] === b.components[key]) { matched.push(key); score += weight; }
    else changed.push(key);
  }
  // Common screen/browser settings alone never qualify. Scores are rules, not probabilities.
  const qualifies = matched.includes("canvas") && matched.includes("webgl") && matched.length >= 5 && score >= 9;
  return { score, maximumScore: 11, matched, changed, unavailable, qualifies };
}
export function evaluateBrowserContinuity(current, previous, limited) {
  const availableComponents = Object.keys(current.components);
  const unavailableComponents = Object.keys(SIGNATURE_COMPONENTS).filter(key=>!current.components[key]);
  if (limited) return { status: "history_limited", availableComponents, unavailableComponents, candidates: [], reasons: ["candidate_history_limit"], inspected: previous.length };
  const candidates = previous.map(row => ({ visitorSessionId: row.visitorSessionId, lastSeenAt: row.lastSeenAt,
    ...compareBrowserSignatures(current, row.signature) })).filter(row => row.qualifies)
    .sort((a,b) => b.score - a.score || b.lastSeenAt.localeCompare(a.lastSeenAt) || a.visitorSessionId.localeCompare(b.visitorSessionId));
  return { status: candidates.length > 1 ? "ambiguous" : candidates.length === 1 ? "possible_return" : "no_match",
    availableComponents, unavailableComponents, candidates: candidates.slice(0,5), candidateCount: candidates.length, inspected: previous.length,
    reasons: candidates.length > 1 ? ["multiple_browsers_share_signals"] : candidates.length ? ["rendering_and_context_agree"] : ["insufficient_distinctive_agreement"] };
}
export function continuityReport(observations, limited) {
  const counts = { possible_return: 0, ambiguous: 0, no_match: 0, history_limited: 0 };
  for (const row of observations) if (Object.hasOwn(counts, row.evidence.status)) counts[row.evidence.status]++;
  return { availability: "available", mode: "evaluation", retentionDays: CONTINUITY_DAYS, counts, observations, limited,
    explanation: "Possible browser connections from client-supplied signals, not verified people. Scores are matching rules, not probability percentages. No histories are merged, no campaign credit changes and no inferred identity is sent to advertising platforms. Similar devices can collide; browsers can change, block or randomize signals. Only saved, consented observations are inspected; this is not a count of every site visitor." };
}
