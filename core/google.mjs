import { KitError, object, textValue } from "./primitives.mjs";
import { BUSINESS_EVENTS, businessEventName } from "./events.mjs";

// This kit deliberately limits source age to 28 days. Google account/action
// windows can be shorter; the provider's processing receipt remains authoritative.
export const GOOGLE_MAX_AGE_MS = 28 * 86400000;
export const GOOGLE_MAX_ATTEMPTS = 8;
export const GOOGLE_RETRY_WINDOW_MS = 46 * 3600000;
const fail = message => { throw new KitError("INVALID_GOOGLE", message, 400); };
function keys(value, allowed) { if (Object.keys(value).some(k => !allowed.includes(k))) fail("Unsupported Google field."); }
export function validateGoogle(raw) {
  const v = object(raw, "Google Ads conversion");
  keys(v, ["version", "deliveryOwner", "dataProvenance", "consent", "transactionId", "eventSource", "adIdentifiers", "userData"]);
  if (v.version !== 1 || !["self", "external"].includes(v.deliveryOwner)) fail("Declare Google version 1 and self or external delivery ownership.");
  if (v.dataProvenance !== "customer_provided") fail("Only permissioned customer-provided Google data is supported.");
  const consent = object(v.consent, "Google consent"); keys(consent, ["adUserData", "adPersonalization"]);
  for (const key of ["adUserData", "adPersonalization"]) if (!["granted", "denied"].includes(consent[key])) fail("Declare both Google consent choices.");
  if (!["WEB", "APP", "IN_STORE", "PHONE", "MESSAGE", "OTHER"].includes(v.eventSource)) fail("Declare the actual Google event source.");
  const transactionId = v.transactionId == null ? null : textValue(v.transactionId, "transactionId", 128);
  if (transactionId && !/^[A-Za-z0-9_:.\/-]+$/.test(transactionId)) fail("Use an opaque transactionId without personal data.");
  const ids = object(v.adIdentifiers ?? {}, "Google adIdentifiers"); keys(ids, ["gclid", "gbraid", "wbraid"]);
  const adIdentifiers = {};
  for (const key of ["gclid", "gbraid", "wbraid"]) if (ids[key] != null) {
    const id = textValue(ids[key], key, 512);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) fail("Invalid Google click identifier.");
    adIdentifiers[key] = id;
  }
  const input = object(v.userData ?? {}, "Google userData"); keys(input, ["emailSha256", "phoneSha256"]);
  const userData = {};
  for (const key of ["emailSha256", "phoneSha256"]) if (input[key] != null) {
    if (typeof input[key] !== "string" || !/^[a-f0-9]{64}$/i.test(input[key])) fail("Google matching fields must be normalized SHA-256 hex digests.");
    userData[key] = input[key].toLowerCase();
  }
  return { version: 1, deliveryOwner: v.deliveryOwner, dataProvenance: v.dataProvenance,
    consent: { adUserData: consent.adUserData, adPersonalization: consent.adPersonalization }, transactionId, eventSource: v.eventSource, adIdentifiers, userData };
}
export function validateGoogleDestination(raw) {
  const v = object(raw, "Google Ads destination"); keys(v, ["accountId", "loginAccountId", "conversionActions", "mode"]);
  if (!/^\d{10}$/.test(v.accountId ?? "")) fail("Supply the ten-digit Google Ads account ID without hyphens.");
  if (v.loginAccountId != null && !/^\d{10}$/.test(v.loginAccountId)) fail("Invalid Google Ads manager/login account ID.");
  if (!["disabled", "validate", "live"].includes(v.mode)) fail("Choose disabled, validate or live Google mode.");
  const actions = object(v.conversionActions, "Google conversion actions");
  if (!Object.keys(actions).length || Object.keys(actions).some(k => !BUSINESS_EVENTS.includes(k))) fail("Map supported business events to conversion actions.");
  const seen = new Set();
  for (const id of Object.values(actions)) {
    if (typeof id !== "string" || !/^\d{1,30}$/.test(id)) fail("Conversion action IDs must be numeric strings.");
    if (seen.has(id)) fail("Each business stage needs its own conversion action to avoid mixed conversion meanings.");
    seen.add(id);
  }
  return { accountId: v.accountId, loginAccountId: v.loginAccountId ?? null, mode: v.mode, conversionActions: { ...actions } };
}
export function googleEligibility(outcome, destination, now) {
  if (outcome.deleted) return "outcome_deleted";
  if (!outcome.googleAds) return "not_requested";
  const g = validateGoogle(outcome.googleAds);
  if (g.deliveryOwner === "external") return "external_sender";
  if (g.consent.adUserData !== "granted") return "consent_denied";
  const name = businessEventName(outcome);
  if (!name || !destination.conversionActions[name]) return "conversion_action_missing";
  const time = Date.parse(outcome.occurredAt), current = Date.parse(now);
  if (!Number.isFinite(time)) return "time_missing";
  if (time > current) return "event_in_future";
  if (current - time >= GOOGLE_MAX_AGE_MS) return "event_expired";
  if (!Object.keys(g.adIdentifiers).length && !Object.keys(g.userData).length) return "matching_data_missing";
  if (name === "payment_received" && (outcome.amountMinor == null || !outcome.currency)) return "payment_value_missing";
  return null;
}
export function googleRetry(attempt, firstAttemptAt, eventTime, now, retryAfterSeconds) {
  const deadline = Math.min(Date.parse(firstAttemptAt) + GOOGLE_RETRY_WINDOW_MS, Date.parse(eventTime) + GOOGLE_MAX_AGE_MS);
  const delay = Math.max(Math.min(3600, 30 * 2 ** (attempt - 1)), retryAfterSeconds ?? 0);
  const next = Date.parse(now) + delay * 1000;
  return attempt >= GOOGLE_MAX_ATTEMPTS || next >= deadline ? null : new Date(next).toISOString();
}
