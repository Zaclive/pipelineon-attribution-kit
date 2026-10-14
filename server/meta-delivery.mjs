import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KitError, META_GRAPH_VERSION, META_RETRY_WINDOW_MS, metaEligibility, metaEventName, metaRetry, validateMeta } from "../core/index.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
export function buildMetaSnapshot(outcome, siteId, destination) {
  const meta = validateMeta(outcome.meta);
  const name = metaEventName(outcome);
  const eventId = meta.eventId ?? `oa_v1_${digest(JSON.stringify([siteId, outcome.source, outcome.externalId, name]))}`;
  const user = {};
  for (const [input, output] of [["emailSha256", "em"], ["phoneSha256", "ph"], ["externalIdSha256", "external_id"]]) {
    if (meta.userData[input]) user[output] = [meta.userData[input]];
  }
  for (const [input, output] of [["fbp", "fbp"], ["fbc", "fbc"], ["clientUserAgent", "client_user_agent"]]) {
    if (meta.userData[input]) user[output] = meta.userData[input];
  }
  const event = { event_name: name, event_id: eventId, event_time: Math.floor(Date.parse(outcome.occurredAt) / 1000), action_source: meta.actionSource, user_data: user };
  if (meta.eventSourceUrl) event.event_source_url = meta.eventSourceUrl;
  if (name === "Purchase") {
    if (!Intl.supportedValuesOf("currency").includes(outcome.currency)) throw new KitError("INVALID_CURRENCY", "Unsupported payment currency.", 400);
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: outcome.currency }).resolvedOptions().maximumFractionDigits;
    event.custom_data = { currency: outcome.currency, value: outcome.amountMinor / 10 ** digits };
  }
  const body = { data: [event], ...(destination.mode === "test" ? { test_event_code: destination.testEventCode } : {}) };
  return { datasetId: destination.datasetId, mode: destination.mode, testEventCode: destination.testEventCode,
    eventId, eventName: name, body, fingerprint: digest(JSON.stringify(body)),
    identity: digest(JSON.stringify([destination.datasetId, destination.mode, destination.testEventCode, name, eventId])) };
}

// Provider text may echo identifiers or tokens. Persist only this bounded receipt projection.
export async function sendMeta(snapshot, accessToken, fetcher) {
  let response;
  let result;
  try {
    response = await fetcher(`https://graph.facebook.com/${META_GRAPH_VERSION}/${snapshot.datasetId}/events`, {
      method: "POST", redirect: "error", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(snapshot.body), signal: AbortSignal.timeout(10000),
    });
    const reader = response.body?.getReader();
    let text = "";
    if (reader) {
      try {
        const decoder = new TextDecoder();
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) { await reader.cancel(); return { accepted: false, retryable: true, reason: "unconfirmed_response", httpStatus: response.status }; }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    try { result = JSON.parse(text); } catch { result = null; }
  } catch { return { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null }; }
  const code = Number.isSafeInteger(result?.error?.code) ? result.error.code : null;
  const subcode = Number.isSafeInteger(result?.error?.error_subcode) ? result.error.error_subcode : null;
  const rawTrace = result?.fbtrace_id ?? result?.error?.fbtrace_id;
  const traceId = typeof rawTrace === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(rawTrace) ? rawTrace : null;
  const accepted = response.ok && result?.events_received === 1 && !result?.error;
  const retryable = !accepted && (response.status >= 500 || response.status === 429 || response.status === 408 || result?.error?.is_transient === true || [1, 2, 4, 17, 32, 341, 613].includes(code) || (response.ok && !result?.error));
  const retryHeader = response.headers.get("retry-after");
  const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : retryHeader ? Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) : null;
  return { accepted, retryable, reason: accepted ? "meta_received" : response.ok && !result?.error ? "unconfirmed_response" : "meta_rejected",
    httpStatus: response.status, eventsReceived: accepted ? 1 : 0, traceId, errorCode: code, errorSubcode: subcode,
    retryAfterSeconds: Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : null };
}

// Adapters own transactions and leases. This worker is shared by SQLite and Postgres.
export async function processMetaQueue(repository, options) {
  const counts = { inspected: 0, accepted: 0, retry: 0, stopped: 0 };
  for (let index = 0; index < options.limit; index++) {
    const now = options.now();
    const job = await repository.claim(now);
    if (!job) break;
    counts.inspected++;
    let reason = metaEligibility(job.outcome, now);
    let snapshot;
    if (!reason) {
      try { snapshot = buildMetaSnapshot(job.outcome, job.siteId, job.destination); }
      catch (error) { if (!(error instanceof KitError)) throw error; reason = error.code === "INVALID_CURRENCY" ? "currency_unsupported" : "invalid_conversion"; }
    }
    if (!reason && job.snapshot && (snapshot.identity !== job.snapshot.identity || snapshot.fingerprint !== job.snapshot.fingerprint)) reason = "changed_after_attempt";
    if (!reason && job.firstAttemptAt && Date.parse(now) >= Date.parse(job.firstAttemptAt) + META_RETRY_WINDOW_MS) reason = "retry_window_expired";
    if (reason) {
      await repository.finish(job, { status: job.attempts > 0 ? "review" : ["outcome_deleted", "not_requested", "external_sender", "consent_denied"].includes(reason) ? "skipped" : "blocked", reason, nextAttemptAt: null, receipt: null }, now);
      counts.stopped++;
      continue;
    }
    const started = await repository.begin(job, job.snapshot ?? snapshot, now);
    if (!started) continue; // Source/configuration changed while this worker was preparing.
    let receipt;
    try { receipt = await options.send(started.snapshot, started.accessToken); }
    catch { receipt = { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null }; }
    const finishedAt = options.now();
    const next = receipt.retryable ? metaRetry(started.attempts, started.firstAttemptAt, started.snapshot.body.data[0].event_time, finishedAt, receipt.retryAfterSeconds) : null;
    const status = receipt.accepted ? "accepted" : next ? "retry" : receipt.retryable ? "review" : "failed";
    await repository.finish(started, { status, reason: receipt.retryable && !next ? "retry_budget_exhausted" : receipt.reason, nextAttemptAt: next, receipt }, finishedAt);
    if (status === "accepted") counts.accepted++;
    else if (status === "retry") counts.retry++;
    else counts.stopped++;
  }
  return counts;
}

export function encryptMetaSecret(value, hexKey, context) {
  if (!/^[a-f0-9]{64}$/i.test(hexKey ?? "")) throw new KitError("META_KEY_MISSING", "Configure a 32-byte Meta encryption key.", 503);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptMetaSecret(value, hexKey, context) {
  if (!/^[a-f0-9]{64}$/i.test(hexKey ?? "")) throw new KitError("META_KEY_MISSING", "Configure a 32-byte Meta encryption key.", 503);
  try {
    const [version, iv, tag, body, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !body || extra) throw new KitError("META_SECRET_INVALID", "Invalid secret envelope.", 500);
    const cipher = createDecipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), Buffer.from(iv, "base64url"));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([cipher.update(Buffer.from(body, "base64url")), cipher.final()]).toString("utf8");
  } catch { throw new KitError("META_SECRET_INVALID", "The Meta secret could not be decrypted.", 503); }
}
