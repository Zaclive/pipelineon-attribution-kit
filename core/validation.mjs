import { validateMeta } from "./meta.mjs";
import { KitError, object, textValue, timestamp, sessionReference } from "./primitives.mjs";
export { KitError, object, textValue, timestamp, sessionReference } from "./primitives.mjs";
export const MODELS = ["first_touch", "last_touch", "last_non_direct"];
export function validateOutcome(raw) {
  const input = object(raw, "Outcome");
  const allowed = ["externalId", "source", "eventType", "occurredAt", "sourceUpdatedAt", "outcome", "qualification", "visitorSessionId", "amountMinor", "currency", "deleted", "contactIds", "direction", "label", "meta"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new KitError("INVALID_INPUT", "Unsupported outcome field.", 400);
  const externalId = textValue(input.externalId, "externalId", 200);
  const source = textValue(input.source, "source", 64);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(source)) throw new KitError("INVALID_INPUT", "Invalid source identifier.", 400);
  const occurredAt = timestamp(input.occurredAt, "occurredAt");
  const sourceUpdatedAt = timestamp(input.sourceUpdatedAt, "sourceUpdatedAt");
  if (occurredAt > sourceUpdatedAt) throw new KitError("INVALID_INPUT", "Outcome cannot follow its source update.", 400);
  if (!["call", "form", "estimate", "booking", "payment", "email", "sms", "postcard", "note", "stage_change"].includes(input.eventType)) throw new KitError("INVALID_INPUT", "Unsupported eventType.", 400);
  if (!["received", "completed", "missed", "failed", "unknown"].includes(input.outcome)) throw new KitError("INVALID_INPUT", "Unsupported outcome.", 400);
  const qualification = input.qualification ?? "unknown";
  if (!["qualified", "unqualified", "unknown"].includes(qualification)) throw new KitError("INVALID_INPUT", "Invalid qualification.", 400);
  const amountMinor = input.amountMinor ?? null;
  const currency = input.currency ?? null;
  if ((amountMinor === null) !== (currency === null) || (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 100000000000 || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))))
    throw new KitError("INVALID_INPUT", "Supply an integer amountMinor and uppercase currency together.", 400);
  if (input.deleted !== undefined && typeof input.deleted !== "boolean") throw new KitError("INVALID_INPUT", "deleted must be boolean.", 400);
  const contactIds = input.contactIds ?? [];
  if (!Array.isArray(contactIds) || contactIds.length > 50) throw new KitError("INVALID_INPUT", "Invalid contactIds.", 400);
  const direction = input.direction ?? "unknown";
  if (!["inbound", "outbound", "unknown"].includes(direction)) throw new KitError("INVALID_INPUT", "Invalid direction.", 400);
  return { externalId, source, eventType: input.eventType, occurredAt, sourceUpdatedAt, outcome: input.outcome,
    qualification, visitorSessionId: sessionReference(input.visitorSessionId), amountMinor, currency,
    deleted: input.deleted ?? false, contactIds: contactIds.map(id => textValue(id, "contactId", 200)), direction,
    label: input.label == null ? `${input.eventType} ${input.outcome}` : textValue(input.label, "label", 300),
    ...(input.meta == null ? {} : { meta: validateMeta(input.meta) }) };
}
export function reportRange(raw, now) {
  const input = object(raw, "Report range");
  const from = timestamp(input.from, "from");
  const to = timestamp(input.to, "to");
  if (from >= to || Date.parse(to) - Date.parse(from) > 31 * 86400000 || Date.parse(to) > Date.parse(now) + 300000)
    throw new KitError("INVALID_RANGE", "Choose a past range of at most 31 days (end exclusive).", 400);
  const model = input.model ?? "last_non_direct";
  if (!MODELS.includes(model)) throw new KitError("INVALID_INPUT", "Invalid attribution model.", 400);
  return { from, to, model };
}
export function normalizeCall(raw) {
  const input = object(raw, "Call");
  const allowed = ["provider", "accountId", "callId", "occurredAt", "sourceUpdatedAt", "status", "qualification", "visitorSessionId", "contactIds", "direction", "meta"];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new KitError("INVALID_INPUT", "Unsupported call field. Send payment facts separately.", 400);
  if (!["callrail", "ringba", "other"].includes(input.provider)) throw new KitError("INVALID_INPUT", "Unsupported call provider.", 400);
  const account = textValue(input.accountId, "accountId", 80);
  const call = textValue(input.callId, "callId", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(account)) throw new KitError("INVALID_INPUT", "Use an alphanumeric provider account ID.", 400);
  if (!["answered", "missed", "failed", "unknown"].includes(input.status)) throw new KitError("INVALID_INPUT", "Invalid call status.", 400);
  return validateOutcome({ externalId: `${account}:${call}`, source: input.provider, eventType: "call",
    occurredAt: input.occurredAt, sourceUpdatedAt: input.sourceUpdatedAt,
    outcome: input.status === "answered" ? "completed" : input.status,
    qualification: input.qualification ?? "unknown", visitorSessionId: input.visitorSessionId ?? null,
    contactIds: input.contactIds ?? [], direction: input.direction ?? "inbound", label: `${input.provider} call: ${input.status}`,
    ...(input.meta == null ? {} : { meta: input.meta }) });
}
