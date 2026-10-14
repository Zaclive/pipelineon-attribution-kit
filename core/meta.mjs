import { KitError, object, textValue, timestamp } from "./primitives.mjs";
import { safePage } from "./tracking.mjs";

export const META_GRAPH_VERSION = "v25.0";
export const META_MAX_AGE_MS = 7 * 86400000;
// Leave room for clock skew and network delay before Meta's 48-hour dedup window.
export const META_RETRY_WINDOW_MS = 46 * 3600000;
export const META_MAX_ATTEMPTS = 8;
const fail = message => { throw new KitError("INVALID_META", message, 400); };
function keys(value, allowed) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("Unsupported Meta field.");
}
export function validateMeta(raw) {
  const value = object(raw, "Meta conversion");
  keys(value, ["version", "deliveryOwner", "consent", "dataProvenance", "deduplication", "eventId", "actionSource", "eventSourceUrl", "userData"]);
  if (value.version !== 1) fail("Meta version must be 1.");
  if (!["self", "external"].includes(value.deliveryOwner)) fail("Choose self or external as the conversion sender.");
  if (!["granted", "denied"].includes(value.consent)) fail("Declare advertising measurement consent.");
  if (value.dataProvenance !== "customer_provided") fail("Only permissioned, customer-provided matching data is supported.");
  if (!["server_only", "shared_event_id"].includes(value.deduplication)) fail("Declare server_only or shared_event_id deduplication.");
  if (!["website", "phone_call", "physical_store", "chat", "email", "system_generated", "other"].includes(value.actionSource)) fail("Unsupported actionSource.");
  const eventId = value.eventId == null ? null : textValue(value.eventId, "eventId", 128);
  if (eventId && !/^[A-Za-z0-9_:.\/-]+$/.test(eventId)) fail("Use an opaque eventId without personal data or whitespace.");
  if (value.deduplication === "shared_event_id" && !eventId) fail("A shared browser/server conversion needs the same eventId.");
  const page = value.eventSourceUrl == null ? null : safePage(value.eventSourceUrl);
  if (value.eventSourceUrl != null && (!page || !page.url.startsWith("https://"))) fail("eventSourceUrl must be an HTTPS page URL.");
  const data = object(value.userData ?? {}, "Meta userData");
  keys(data, ["emailSha256", "phoneSha256", "externalIdSha256", "fbp", "fbc", "clientUserAgent"]);
  const userData = {};
  for (const key of ["emailSha256", "phoneSha256", "externalIdSha256"]) {
    if (data[key] != null) {
      if (typeof data[key] !== "string" || !/^[a-f0-9]{64}$/i.test(data[key])) fail(`${key} must be a SHA-256 hex digest, not a raw identifier.`);
      userData[key] = data[key].toLowerCase();
    }
  }
  for (const key of ["fbp", "fbc"]) {
    if (data[key] != null) {
      const id = textValue(data[key], key, 500);
      if (!/^fb\.[0-9]+\.[0-9]{13}\.[A-Za-z0-9_-]+$/.test(id)) fail(`Invalid ${key} format.`);
      userData[key] = id;
    }
  }
  if (data.clientUserAgent != null) userData.clientUserAgent = textValue(data.clientUserAgent, "clientUserAgent", 1000);
  return { version: 1, deliveryOwner: value.deliveryOwner, consent: value.consent, dataProvenance: value.dataProvenance,
    deduplication: value.deduplication, eventId, actionSource: value.actionSource, eventSourceUrl: page?.url ?? null, userData };
}
export function validateMetaDestination(raw) {
  const value = object(raw, "Meta destination");
  keys(value, ["datasetId", "mode", "testEventCode"]);
  if (!/^[0-9]{5,30}$/.test(value.datasetId ?? "")) fail("Supply the numeric Meta dataset/pixel ID.");
  if (!["disabled", "test", "live"].includes(value.mode)) fail("Choose disabled, test or live mode.");
  const code = value.testEventCode == null || value.testEventCode === "" ? null : textValue(value.testEventCode, "testEventCode", 100);
  if (code && !/^[A-Za-z0-9_-]+$/.test(code)) fail("Invalid Meta test-event code.");
  if (value.mode === "test" && !code) fail("Test mode requires an Events Manager test-event code.");
  if (value.mode === "live" && code) fail("Remove the test-event code before selecting live mode.");
  return { datasetId: value.datasetId, mode: value.mode, testEventCode: code };
}
export function metaEventName(outcome) {
  if (outcome.eventType === "payment" && outcome.outcome === "completed") return "Purchase";
  if (outcome.eventType === "booking" && outcome.outcome === "completed") return "Schedule";
  if (outcome.eventType === "form" && ["received", "completed"].includes(outcome.outcome)) return "Lead";
  if (outcome.eventType === "call" && outcome.outcome === "completed" && outcome.qualification === "qualified") return "Lead";
  return null;
}
export function metaEligibility(outcome, now) {
  if (outcome.deleted) return "outcome_deleted";
  if (!outcome.meta) return "not_requested";
  const meta = validateMeta(outcome.meta);
  if (meta.deliveryOwner === "external") return "external_sender";
  if (meta.consent !== "granted") return "consent_denied";
  if (!metaEventName(outcome)) return "outcome_not_supported";
  if (!outcome.occurredAt) return "time_missing";
  const at = Date.parse(timestamp(outcome.occurredAt, "occurredAt"));
  if (at > Date.parse(now)) return "event_in_future";
  if (Date.parse(now) - at >= META_MAX_AGE_MS) return "event_expired";
  if (meta.actionSource === "website" && (!meta.eventSourceUrl || !meta.userData.clientUserAgent)) return "website_context_missing";
  if (!["emailSha256", "phoneSha256", "fbc", "fbp", "externalIdSha256"].some(key => meta.userData[key])) return "matching_data_missing";
  if (metaEventName(outcome) === "Purchase" && (outcome.amountMinor == null || !outcome.currency)) return "payment_value_missing";
  return null;
}
export function metaRetry(attempt, firstAttemptAt, eventTime, now, retryAfterSeconds) {
  const deadline = Math.min(Date.parse(firstAttemptAt) + META_RETRY_WINDOW_MS, eventTime * 1000 + META_MAX_AGE_MS);
  const delay = Math.max(Math.min(3600, 30 * 2 ** (attempt - 1)), retryAfterSeconds ?? 0);
  const next = Date.parse(now) + delay * 1000;
  return attempt >= META_MAX_ATTEMPTS || next >= deadline ? null : new Date(next).toISOString();
}
