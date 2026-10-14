import { normalizeCall, object, KitError } from "../core/index.mjs";
/** A trusted, signature-verified CallRail event or API response. No network calls. */
export function callRailAdapter(payload, context) {
  const call = object(payload, "CallRail call");
  if (String(call.company_id) !== context.accountId) throw new KitError("ACCOUNT_MISMATCH", "CallRail company does not match the configured account.", 400);
  if (typeof call.answered !== "boolean" || !["inbound", "outbound"].includes(call.direction)) throw new KitError("INVALID_INPUT", "Use a completed CallRail call with an explicit answered flag and direction.", 400);
  const normalized = {
    provider: "callrail", accountId: context.accountId, callId: String(call.id),
    occurredAt: call.start_time, sourceUpdatedAt: context.sourceUpdatedAt,
    status: call.answered ? "answered" : "missed", direction: call.direction,
    qualification: context.qualification, visitorSessionId: context.visitorSessionId,
  };
  normalizeCall(normalized);
  if (!call.id) throw new KitError("INVALID_INPUT", "CallRail call ID is required.", 400);
  return normalized;
}
