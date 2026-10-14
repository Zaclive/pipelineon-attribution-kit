import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { KitError, object, normalizeCall } from "../core/index.mjs";

const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const callrailHash = value => createHash("sha256").update(value).digest("hex");
export function validateCallrailConfig(raw) {
  const config = object(raw, "CallRail configuration");
  for (const key of ["accountId", "companyId"]) if (!idPattern.test(config[key] ?? "")) throw new KitError("CALLRAIL_CONFIG", "Supply the CallRail account and company IDs.", 400);
  if (!/^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(config.cookieName ?? "")) throw new KitError("CALLRAIL_CONFIG", "Use a unique cookie name containing letters, digits and underscores.", 400);
  if (!["self", "external"].includes(config.deliveryOwner)) throw new KitError("CALLRAIL_CONFIG", "Choose which integration owns Meta delivery.", 400);
  for (const key of ["apiKey", "signingKey"]) if (typeof config[key] !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(config[key])) throw new KitError("CALLRAIL_CONFIG", "Supply the API key and webhook signing key.", 400);
  return { accountId: config.accountId, companyId: config.companyId, cookieName: config.cookieName,
    deliveryOwner: config.deliveryOwner, apiKey: config.apiKey, signingKey: config.signingKey };
}

// Verify the bytes actually received, before parsing JSON. Never stringify a parsed body here.
export function verifyCallrailWebhook(rawBody, signature, signingKey, companyId) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 65536) throw new KitError("BODY_TOO_LARGE", "Webhook exceeds 64 KiB.", 413);
  const expected = createHmac("sha1", signingKey).update(rawBody).digest("base64");
  if (typeof signature !== "string" || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    throw new KitError("CALLRAIL_SIGNATURE", "Invalid CallRail signature.", 401);
  let data;
  try { data = JSON.parse(rawBody.toString("utf8")); } catch { throw new KitError("INVALID_JSON", "Invalid webhook JSON.", 400); }
  object(data, "Webhook");
  if (String(data.company_id) !== companyId) throw new KitError("CALLRAIL_COMPANY", "Webhook belongs to another company.", 403);
  if (typeof data.id !== "string" || !idPattern.test(data.id)) throw new KitError("CALLRAIL_CALL_ID", "Invalid call ID.", 400);
  return { callId: data.id, digest: callrailHash(rawBody) };
}

async function requestCallrail(config, path, fetcher) {
  let response;
  try {
    response = await fetcher(`https://api.callrail.com/v3/a/${encodeURIComponent(config.accountId)}/${path}`, {
      headers: { Authorization: `Token token="${config.apiKey}"`, "Request-From": "pipelineon" },
      redirect: "error", signal: AbortSignal.timeout(6000),
    });
  } catch { throw new KitError("CALLRAIL_TRANSPORT", "CallRail could not be reached. The call will be retried.", 503); }
  if (!response.ok) {
    const retryHeader = response.headers.get("retry-after");
    const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : retryHeader ? Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) : null;
    const retryAfterSeconds = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.min(86400, retrySeconds) : null;
    await response.body?.cancel();
    const error = new KitError(response.status === 429 ? "CALLRAIL_RATE_LIMIT" : response.status >= 500 ? "CALLRAIL_UNAVAILABLE" : "CALLRAIL_ACCESS",
      "CallRail rejected the request. Check the connection and its permissions.", response.status === 429 ? 429 : response.status >= 500 ? 503 : 422);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new KitError("CALLRAIL_RESPONSE", "CallRail returned no call details.", 503);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 262144) { await reader.cancel(); throw new KitError("CALLRAIL_RESPONSE", "CallRail response exceeds the size limit.", 422); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8")), "CallRail response"); }
  catch { throw new KitError("CALLRAIL_RESPONSE", "CallRail returned invalid details.", 503); }
}
export async function checkCallrailCompany(config, fetcher) {
  const data = await requestCallrail(config, `companies/${encodeURIComponent(config.companyId)}.json`, fetcher);
  if (String(data.id) !== config.companyId) throw new KitError("CALLRAIL_COMPANY", "The API key did not return the selected company.", 422);
  return true;
}
export async function fetchCallrailCall(config, callId, fetcher) {
  if (!idPattern.test(callId)) throw new KitError("CALLRAIL_CALL_ID", "Invalid call ID.", 400);
  const data = await requestCallrail(config, `calls/${encodeURIComponent(callId)}.json?fields=company_id,custom,lead_status,call_type`, fetcher);
  if (data.id !== callId || String(data.company_id) !== config.companyId) throw new KitError("CALLRAIL_COMPANY", "Call does not belong to this connection.", 422);
  return data;
}

export function mapCallrailCall(raw, config, now) {
  const call = object(raw, "CallRail call");
  if (String(call.company_id) !== config.companyId || typeof call.id !== "string" || !idPattern.test(call.id)) throw new KitError("CALLRAIL_COMPANY", "Call does not belong to this connection.", 422);
  if (call.call_type === "in_progress") throw new KitError("CALLRAIL_IN_PROGRESS", "Call is still in progress.", 503);
  if (typeof call.answered !== "boolean" || !["inbound", "outbound"].includes(call.direction) || typeof call.start_time !== "string")
    throw new KitError("CALLRAIL_RESPONSE", "CallRail call is missing required facts.", 422);
  const custom = call.custom && typeof call.custom === "object" && !Array.isArray(call.custom) ? call.custom : {};
  const reference = custom[config.cookieName];
  const visitorSessionId = typeof reference === "string" && uuidPattern.test(reference) ? reference : null;
  // A paired, call-captured consent cookie is required. Mere script readiness never grants consent.
  const consent = visitorSessionId && custom[config.cookieName + "_ads"] === visitorSessionId ? "granted" : "denied";
  const phone = typeof call.customer_phone_number === "string" && /^\+[1-9][0-9]{7,14}$/.test(call.customer_phone_number) ? call.customer_phone_number.slice(1) : null;
  const qualification = call.lead_status === "good_lead" ? "qualified" : call.lead_status === "not_a_lead" ? "unqualified" : "unknown";
  const outcome = normalizeCall({ provider: "callrail", accountId: config.companyId, callId: call.id,
    occurredAt: call.start_time, sourceUpdatedAt: now, status: call.answered ? "answered" : "missed",
    direction: call.direction, qualification, visitorSessionId,
    meta: { version: 1, deliveryOwner: config.deliveryOwner, consent: call.direction === "inbound" ? consent : "denied",
      dataProvenance: "customer_provided", deduplication: "server_only", actionSource: "phone_call",
      eventId: `cr_${callrailHash(JSON.stringify([config.companyId, call.id, "Lead"]))}`,
      userData: consent === "granted" && call.direction === "inbound" && phone ? { phoneSha256: callrailHash(phone) } : {} },
  });
  return outcome;
}

// Both repositories finish the import and receipt in one transaction. Replayed/out-of-order
// webhooks only trigger an authoritative API read, never a new version of an old raw payload.
export async function processCallrailQueue(repository, options) {
  let processed = 0;
  for (let i = 0; i < options.limit; i++) {
    const job = await repository.claim(options.now());
    if (!job) break;
    try {
      const config = await options.config(job);
      const raw = await fetchCallrailCall(config, job.callId, options.fetcher);
      const outcome = mapCallrailCall(raw, config, options.now());
      await repository.complete(job, outcome, options.now());
    } catch (error) {
      const reason = error instanceof KitError ? error.code : "CALLRAIL_WORKER_ERROR";
      const retryable = !(error instanceof KitError) || error.status === 429 || error.status >= 500;
      const retryAfterSeconds = error instanceof KitError && Number.isFinite(error.retryAfterSeconds) ? error.retryAfterSeconds : null;
      await repository.fail(job, { reason, retryable, retryAfterSeconds }, options.now());
    }
    processed++;
  }
  return { processed };
}
