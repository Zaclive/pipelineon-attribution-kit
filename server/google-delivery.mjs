import { createHash } from "node:crypto";
import { KitError, businessEventName, googleEligibility, googleRetry, GOOGLE_RETRY_WINDOW_MS, validateGoogle, validateGoogleDestination } from "../core/index.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const endpoint = "https://datamanager.googleapis.com/v1";
export function buildGoogleSnapshot(outcome, siteId, destination) {
  const config = validateGoogleDestination(destination), g = validateGoogle(outcome.googleAds), name = businessEventName(outcome);
  const conversionActionId = config.conversionActions[name];
  if (!conversionActionId) throw new KitError("INVALID_GOOGLE", "Map this business event to a Google conversion action.", 400);
  const transactionId = g.transactionId ?? `oa_v1_${digest(JSON.stringify([siteId, outcome.source, outcome.externalId, name]))}`;
  const account = { accountType: "GOOGLE_ADS", accountId: config.accountId };
  const target = { operatingAccount: account, productDestinationId: conversionActionId };
  if (config.loginAccountId) target.loginAccount = { accountType: "GOOGLE_ADS", accountId: config.loginAccountId };
  const event = { transactionId, eventTimestamp: outcome.occurredAt, eventSource: g.eventSource,
    consent: { adUserData: g.consent.adUserData === "granted" ? "CONSENT_GRANTED" : "CONSENT_DENIED",
      adPersonalization: g.consent.adPersonalization === "granted" ? "CONSENT_GRANTED" : "CONSENT_DENIED" } };
  if (Object.keys(g.adIdentifiers).length) event.adIdentifiers = g.adIdentifiers;
  const identifiers = [];
  if (g.userData.emailSha256) identifiers.push({ emailAddress: g.userData.emailSha256 });
  if (g.userData.phoneSha256) identifiers.push({ phoneNumber: g.userData.phoneSha256 });
  if (identifiers.length) event.userData = { userIdentifiers: identifiers };
  // Values of quotes and won jobs are not collected payment revenue.
  if (name === "payment_received") {
    if (!Intl.supportedValuesOf("currency").includes(outcome.currency)) throw new KitError("INVALID_CURRENCY", "Unsupported payment currency.", 400);
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: outcome.currency }).resolvedOptions().maximumFractionDigits;
    event.conversionValue = outcome.amountMinor / (10 ** digits); event.currency = outcome.currency;
  }
  const body = { destinations: [target], events: [event], validateOnly: config.mode === "validate" };
  if (identifiers.length) body.encoding = "HEX";
  const identity = JSON.stringify([config.accountId, conversionActionId, transactionId]);
  return { accountId: config.accountId, conversionActionId, transactionId, businessEvent: name, mode: config.mode,
    identity, body, fingerprint: digest(JSON.stringify(body)) };
}
async function responseJson(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let text = "", size = 0;
  try {
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) { await reader.cancel(); return null; }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    try { const value = JSON.parse(text); return value && typeof value === "object" && !Array.isArray(value) ? value : null; } catch { return null; }
  } finally { reader.releaseLock(); }
}
function errorReceipt(response, result) {
  const errorCode = typeof result?.error?.status === "string" && /^[A-Z_]{1,80}$/.test(result.error.status) ? result.error.status : null;
  // Google descriptions may echo matching data. Retain only bounded machine reasons from BadRequest.
  const errors = (Array.isArray(result?.error?.details) ? result.error.details : []).slice(0, 20)
    .filter(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.BadRequest")
    .flatMap(detail => Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0, 50) : [])
    .filter(violation => typeof violation?.reason === "string" && /^[A-Z_]{1,120}$/.test(violation.reason))
    .map(violation => ({ reason: violation.reason, count: null }));
  const retryable = response.status >= 500 || [408, 429].includes(response.status) || response.ok && !result;
  const header = response.headers.get("retry-after");
  const delay = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : null;
  return { accepted: false, retryable, reason: response.ok ? "unconfirmed_response" : "google_rejected", httpStatus: response.status,
    errorCode, ...(errors.length ? { errors } : {}), retryAfterSeconds: Number.isFinite(delay) && delay > 0 ? delay : null };
}
// No provider error messages or matching fields are returned in receipts.
export async function sendGoogle(snapshot, accessToken, fetcher) {
  try {
    const response = await fetcher(`${endpoint}/events:ingest`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(snapshot.body), signal: AbortSignal.timeout(10000) });
    const result = await responseJson(response);
    if (!response.ok || !result || result.error) return errorReceipt(response, result);
    if (snapshot.mode === "validate") return { accepted: false, validated: true, retryable: false, reason: "google_validated", httpStatus: response.status };
    const requestId = typeof result.requestId === "string" && /^[A-Za-z0-9_.:+/=-]{1,256}$/.test(result.requestId) ? result.requestId : null;
    if (!requestId) return { accepted: false, retryable: true, reason: "unconfirmed_response", httpStatus: response.status };
    return { accepted: false, submitted: true, retryable: false, reason: "google_submitted", httpStatus: response.status, requestId,
      warningCount: Array.isArray(result.fieldWarnings) ? Math.min(result.fieldWarnings.length, 1000) : 0 };
  } catch { return { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null }; }
}
export async function readGoogleStatus(snapshot, requestId, accessToken, fetcher) {
  try {
    const response = await fetcher(`${endpoint}/requestStatus:retrieve?${new URLSearchParams({ requestId })}`, {
      method: "GET", redirect: "error", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    const result = await responseJson(response);
    if (!response.ok || !result || result.error) return { ...errorReceipt(response, result), requestId };
    const rows = result.requestStatusPerDestination;
    const row = Array.isArray(rows) ? rows.find(r => r.destination?.operatingAccount?.accountType === "GOOGLE_ADS" &&
      r.destination.operatingAccount.accountId === snapshot.accountId && r.destination.productDestinationId === snapshot.conversionActionId) : null;
    if (!row) return { accepted: false, retryable: true, reason: "unconfirmed_response", httpStatus: response.status, requestId };
    const counts = values => Array.isArray(values) ? values.slice(0, 50).filter(v => /^[A-Z_]{1,120}$/.test(v.reason ?? ""))
      .map(v => ({ reason: v.reason, count: /^\d{1,12}$/.test(String(v.recordCount)) ? String(v.recordCount) : null })) : [];
    return { accepted: row.requestStatus === "SUCCESS", processing: row.requestStatus === "PROCESSING", retryable: false,
      reason: row.requestStatus === "SUCCESS" ? "google_processed" : row.requestStatus === "PROCESSING" ? "google_processing" : "google_processing_review",
      httpStatus: response.status, requestId, processingStatus: ["SUCCESS", "PROCESSING", "FAILED", "PARTIAL_SUCCESS"].includes(row.requestStatus) ? row.requestStatus : "UNKNOWN",
      errors: counts(row.errorInfo?.errorCounts), warnings: counts(row.warningInfo?.warningCounts) };
  } catch { return { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null, requestId }; }
}
export function googleTokenProvider(credentials, fetcher, clock) {
  let cached = null, pending = null;
  return async function token() {
    if (cached && cached.until > clock()) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      if (!credentials?.clientId || !credentials?.clientSecret || !credentials?.refreshToken) throw new KitError("GOOGLE_CREDENTIALS", "Configure Google OAuth credentials on the server.", 503);
      const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken }).toString() });
      const result = await responseJson(response);
      if (!response.ok || typeof result?.access_token !== "string" || result.access_token.length < 20 || result.access_token.length > 4096)
        throw new KitError("GOOGLE_CREDENTIALS", "Google authorization failed. Reconnect with the Data Manager scope.", 503);
      cached = { token: result.access_token, until: clock() + Math.max(0, Math.min(Number(result.expires_in) || 0, 3600) - 60) * 1000 };
      return cached.token;
    })().finally(() => { pending = null; });
    return pending;
  };
}
export async function processGoogleQueue(repository, options) {
  const counts = { inspected: 0, submitted: 0, validated: 0, accepted: 0, retry: 0, stopped: 0 };
  for (let i = 0; i < options.limit; i++) {
    const now = options.now(), job = await repository.claim(now); if (!job) break;
    counts.inspected++;
    let reason = googleEligibility(job.outcome, job.destination, now), snapshot;
    if (!reason) {
      try { snapshot = buildGoogleSnapshot(job.outcome, job.siteId, job.destination); }
      catch (error) { if (!(error instanceof KitError)) throw error; reason = error.code === "INVALID_CURRENCY" ? "currency_unsupported" : "invalid_conversion"; }
    }
    if (!reason && job.snapshot && (snapshot.identity !== job.snapshot.identity || snapshot.fingerprint !== job.snapshot.fingerprint)) reason = "changed_after_attempt";
    if (!reason && job.firstAttemptAt && Date.parse(now) >= Date.parse(job.firstAttemptAt) + GOOGLE_RETRY_WINDOW_MS) reason = "retry_window_expired";
    if (reason) {
      await repository.finish(job, { status: job.attempts ? "review" : ["outcome_deleted", "not_requested", "external_sender", "consent_denied"].includes(reason) ? "skipped" : "blocked", reason, nextAttemptAt: null, receipt: null }, now);
      counts.stopped++; continue;
    }
    let token;
    try { token = await options.token(job); }
    catch { await repository.finish(job, { status: "blocked", reason: "credential_unavailable", nextAttemptAt: null, receipt: null }, now); counts.stopped++; continue; }
    const started = await repository.begin(job, job.snapshot ?? snapshot, now); if (!started) continue;
    // Once a request ID exists, only poll. Never submit another ingestion request
    // simply because processing or a status request is slow.
    let receipt;
    try { receipt = started.requestId ? await options.poll(started.snapshot, started.requestId, token) : await options.send(started.snapshot, token); }
    catch { receipt = { accepted: false, retryable: true, reason: "transport_uncertain", httpStatus: null, ...(started.requestId ? { requestId: started.requestId } : {}) }; }
    const finishedAt = options.now();
    let next = null, status;
    if (receipt.validated) status = "validated";
    else if (receipt.accepted) status = "accepted";
    else if (receipt.submitted || started.requestId && (receipt.processing || receipt.retryable)) {
      next = started.polls >= 120 ? null : new Date(Date.parse(finishedAt) + 60000).toISOString();
      status = next ? "submitted" : "review";
    } else {
      next = receipt.retryable ? googleRetry(started.attempts, started.firstAttemptAt, started.outcome.occurredAt, finishedAt, receipt.retryAfterSeconds) : null;
      status = next ? "retry" : started.requestId || receipt.retryable ? "review" : "failed";
    }
    await repository.finish(started, { status, reason: status === "review" && (receipt.processing || receipt.retryable || receipt.submitted) ? "processing_review" : receipt.reason,
      nextAttemptAt: next, receipt }, finishedAt);
    if (status === "accepted") counts.accepted++; else if (status === "validated") counts.validated++;
    else if (status === "submitted") counts.submitted++; else if (status === "retry") counts.retry++; else counts.stopped++;
  }
  return counts;
}
