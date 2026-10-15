import { createServer } from "node:http";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import packageInfo from "../package.json" with { type: "json" };
import { KitError, object, normalizeCall, normalizeBusinessEvent, validateGoogleDestination, reportRange, validateMetaDestination } from "../core/index.mjs";
import { validateCallrailConfig, verifyCallrailWebhook, processCallrailQueue } from "./callrail.mjs";
import { openStore } from "./store.mjs";
import { processMetaQueue, sendMeta } from "./meta-delivery.mjs";
import { processGoogleQueue, sendGoogle, readGoogleStatus, googleTokenProvider } from "./google-delivery.mjs";

const STATIC = { "/": ["../public/index.html", "text/html"], "/app.js": ["../public/app.js", "text/javascript"], "/style.css": ["../public/style.css", "text/css"], "/pixel.js": ["../public/pixel.js", "text/javascript"] };
STATIC["/callrail.js"] = ["../public/callrail.js", "text/javascript"];
STATIC["/callrail-status.js"] = ["../public/callrail-status.js", "text/javascript"];
STATIC["/meta.js"] = ["../public/meta.js", "text/javascript"];
STATIC["/meta-status.js"] = ["../core/meta-status.mjs", "text/javascript"];
STATIC["/google.js"] = ["../public/google.js", "text/javascript"];
const same = (a, b) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function createKitServer(config) {
  if (!config.writeToken || config.writeToken.length < 32 || !config.readToken || config.readToken.length < 32 || config.readToken === config.writeToken)
    throw new KitError("CONFIG", "Set different read and write tokens of at least 32 characters.", 500);
  const publicOrigin = new URL(config.publicUrl).origin;
  if (!/^https:/.test(publicOrigin) && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(publicOrigin).hostname)) throw new KitError("CONFIG", "Use HTTPS outside localhost.", 500);
  const origins = config.origins.map(value => new URL(value).origin);
  if (!origins.length || !config.siteId) throw new KitError("CONFIG", "Set a site ID and at least one allowed website origin.", 500);
  const meta = config.meta ? { ...validateMetaDestination({ datasetId: config.meta.datasetId, mode: config.meta.mode, testEventCode: config.meta.testEventCode }), accessToken: config.meta.accessToken } : null;
  if (meta && meta.mode !== "disabled" && (typeof meta.accessToken !== "string" || meta.accessToken.length < 20 || meta.accessToken.length > 4096))
    throw new KitError("CONFIG", "Set the server-side Meta access token before enabling delivery.", 500);
  const callrail = config.callrail ? validateCallrailConfig(config.callrail) : null;
  const googleAds = config.googleAds ? validateGoogleDestination(config.googleAds) : null;
  const token = config.googleToken ?? googleTokenProvider(config.googleCredentials, config.googleFetch ?? fetch, () => Date.now());
  if (googleAds?.mode !== "disabled" && googleAds && !config.googleToken && (!config.googleCredentials?.clientId || !config.googleCredentials?.clientSecret || !config.googleCredentials?.refreshToken))
    throw new KitError("CONFIG", "Configure server-only Google OAuth credentials before enabling Google delivery.", 500);
  const store = openStore(config.database, config.siteId, meta, callrail, googleAds);
  let pendingGoogle = null;
  function flushGoogle() {
    if (!pendingGoogle) pendingGoogle = processGoogleQueue(store.googleAds, { limit: 5, now: () => new Date().toISOString(), token,
      send: (snapshot, accessToken) => sendGoogle(snapshot, accessToken, config.googleFetch ?? fetch),
      poll: (snapshot, requestId, accessToken) => readGoogleStatus(snapshot, requestId, accessToken, config.googleFetch ?? fetch) }).finally(() => { pendingGoogle = null; });
    return pendingGoogle;
  }
  let pendingCallrail = null;
  function flushCallrail() {
    if (!pendingCallrail) pendingCallrail = processCallrailQueue(store.callrail, { limit: 5, now: () => new Date().toISOString(),
      config: async () => callrail, fetcher: config.callrailFetch ?? fetch }).finally(() => { pendingCallrail = null; });
    return pendingCallrail;
  }
  let pendingFlush = null;
  function flushMeta() {
    if (!pendingFlush) pendingFlush = processMetaQueue(store.meta, { limit: 5, now: () => new Date().toISOString(),
      send: (snapshot, token) => sendMeta(snapshot, token, config.metaFetch ?? fetch) }).finally(() => { pendingFlush = null; });
    return pendingFlush;
  }
  const rates = new Map();
  function rate(key, limit) {
    const minute = Math.floor(Date.now() / 60000);
    if (rates.size > 10000) for (const [id, value] of rates) if (value.minute < minute) rates.delete(id);
    const current = rates.get(key);
    const value = !current || current.minute !== minute ? { minute, count: 1 } : { minute, count: current.count + 1 };
    rates.set(key, value);
    if (value.count > limit || rates.size > 20000) throw new KitError("RATE_LIMITED", "Request limit reached. Try again in a minute.", 429);
  }
  function cookieFor(expiry) {
    const payload = String(expiry);
    return `${payload}.${createHmac("sha256", config.readToken).update(payload).digest("base64url")}`;
  }
  function auth(request, write) {
    const bearer = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (same(bearer, config.writeToken)) return "write";
    if (!write && same(bearer, config.readToken)) return "read";
    if (!write) {
      const cookie = /(?:^|;\s*)kit_session=([^;]+)/.exec(request.headers.cookie ?? "")?.[1];
      const expiry = cookie?.split(".")[0];
      if (expiry && /^\d{13}$/.test(expiry) && Number(expiry) > Date.now() && Number(expiry) <= Date.now() + 8 * 3600000 && same(cookie, cookieFor(expiry))) return "read";
    }
    throw new KitError("UNAUTHORIZED", write ? "A write token is required." : "Sign in or supply a read token.", 401);
  }
  async function rawBody(request) {
    let length = 0;
    const chunks = [];
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 65536) throw new KitError("BODY_TOO_LARGE", "Request exceeds 64 KiB.", 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function body(request) {
    const bytes = await rawBody(request);
    try { return object(JSON.parse(bytes.toString("utf8")), "Request"); }
    catch (error) { if (error instanceof KitError) throw error; throw new KitError("INVALID_JSON", "Invalid JSON body.", 400); }
  }
  const server = createServer(async (request, response) => {
    const now = new Date().toISOString();
    const send = (data, status) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(data)); };
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, publicOrigin);
      const origin = request.headers.origin;
      rate(request.socket.remoteAddress ?? "unknown", 600);
      if (url.pathname === "/webhooks/callrail" && request.method === "POST") {
        if (!callrail) throw new KitError("CALLRAIL_DISABLED", "CallRail is not configured.", 503);
        const event = verifyCallrailWebhook(await rawBody(request), request.headers.signature, callrail.signingKey, callrail.companyId);
        send(store.callrail.enqueue(event.callId, event.digest, now), 202); return;
      }
      if (url.pathname === "/v1/collect") {
        if (!origin || !origins.includes(origin)) throw new KitError("FORBIDDEN", "Website origin is not allowed.", 403);
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        if (request.method === "OPTIONS") {
          response.setHeader("Access-Control-Allow-Methods", "POST"); response.setHeader("Access-Control-Allow-Headers", "Content-Type"); response.writeHead(204); response.end(); return;
        }
        if (request.method !== "POST") throw new KitError("METHOD_NOT_ALLOWED", "Use POST.", 405);
        const input = await body(request);
        if (request.headers["sec-gpc"] === "1" || input.gpc === true) { send({ collected:false,reason:"gpc" },200); return; }
        send(store.collect(input, origin, now), 200); return;
      }
      if (origin && origin !== publicOrigin) throw new KitError("FORBIDDEN", "Origin is not allowed.", 403);
      if (request.method === "GET" && STATIC[url.pathname]) {
        const [path, type] = STATIC[url.pathname];
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }); response.end(await readFile(new URL(path, import.meta.url))); return;
      }
      if (url.pathname === "/health" && request.method === "GET") { send({ status: "ok", version: packageInfo.version }, 200); return; }
      if (url.pathname === "/session" && request.method === "POST") {
        if (origin !== publicOrigin) throw new KitError("FORBIDDEN", "Same-origin sign-in required.", 403);
        rate(`login:${request.socket.remoteAddress}`, 10);
        const input = await body(request);
        if (typeof input.token !== "string" || !same(input.token, config.readToken)) throw new KitError("UNAUTHORIZED", "The read token is incorrect.", 401);
        response.setHeader("Set-Cookie", `kit_session=${cookieFor(Date.now() + 8 * 3600000)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${publicOrigin.startsWith("https:") ? "; Secure" : ""}`);
        send({ signedIn: true }, 200); return;
      }
      if (url.pathname === "/session" && request.method === "DELETE") {
        if (origin !== publicOrigin) throw new KitError("FORBIDDEN", "Same-origin sign-out required.", 403);
        response.setHeader("Set-Cookie", "kit_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); send({ signedIn: false }, 200); return;
      }
      const access = auth(request, ["/v1/identities/hubspot", "/v1/events", "/v1/outcomes", "/v1/calls", "/v1/meta/flush", "/v1/meta/retry", "/v1/google/flush", "/v1/google/retry", "/v1/callrail/flush", "/v1/callrail/retry"].includes(url.pathname) && request.method === "POST");
      rate(`private:${access}`, 120);
      if (url.pathname === "/mcp" && ["GET", "DELETE"].includes(request.method)) {
        response.setHeader("Allow", "POST"); throw new KitError("METHOD_NOT_ALLOWED", "This MCP server uses stateless JSON responses and has no SSE stream.", 405);
      }
      if (url.pathname === "/v1/config" && request.method === "GET") { send({ siteId: config.siteId, name: config.name, origins, publicUrl: publicOrigin }, 200); return; }
      if (url.pathname === "/v1/identities/hubspot" && request.method === "POST") { send(store.people.linkHubSpot(await body(request), now), 200); return; }
      if (url.pathname === "/v1/callrail" && request.method === "GET") { send(store.callrail.list(), 200); return; }
      if (url.pathname === "/v1/callrail/flush" && request.method === "POST") { send(await flushCallrail(), 200); return; }
      if (url.pathname === "/v1/callrail/retry" && request.method === "POST") {
        const input = await body(request);
        if (typeof input.callId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(input.callId) && Object.keys(input).length === 1) {
          send(store.callrail.enqueue(input.callId, "manual_" + randomUUID(), now), 200); return;
        }
        if (typeof input.id !== "string" || Object.keys(input).some(key => key !== "id")) throw new KitError("INVALID_INPUT", "Supply a callId or call receipt id.", 400);
        send(store.callrail.retry(input.id, now), 200); return;
      }
      if (url.pathname === "/v1/meta" && request.method === "GET") { send(store.meta.list(), 200); return; }
      if (url.pathname === "/v1/google" && request.method === "GET") { send(store.googleAds.list(), 200); return; }
      if (url.pathname === "/v1/google/flush" && request.method === "POST") { send(await flushGoogle(), 200); return; }
      if (url.pathname === "/v1/google/retry" && request.method === "POST") { send(store.googleAds.retry((await body(request)).id, now), 200); return; }
      if (url.pathname === "/v1/meta/flush" && request.method === "POST") { send(await flushMeta(), 200); return; }
      if (url.pathname === "/v1/meta/retry" && request.method === "POST") {
        const input = await body(request);
        if (typeof input.id !== "string" || Object.keys(input).some(key => key !== "id")) throw new KitError("INVALID_INPUT", "Supply a delivery id.", 400);
        send(store.meta.retry(input.id, now), 200); return;
      }
      if (["/v1/report", "/v1/doctor", "/v1/recovery", "/v1/continuity"].includes(url.pathname) && request.method === "GET") {
        const range = reportRange(Object.fromEntries(url.searchParams), now);
        if (url.pathname === "/v1/continuity") send(store.continuity.report(range,now),200);
        else if (url.pathname === "/v1/recovery") send(store.recovery(range), 200);
        else { const result = store.report(range, now); send(url.pathname === "/v1/doctor" ? result.doctor : result, 200); }
        return;
      }
      if (["/v1/events", "/v1/outcomes", "/v1/calls"].includes(url.pathname) && request.method === "POST") {
        const input = await body(request);
        send(store.importOutcome(url.pathname === "/v1/calls" ? normalizeCall(input) : url.pathname === "/v1/events" ? normalizeBusinessEvent(input) : input, now), 200); return;
      }
      if (url.pathname === "/v1/export" && request.method === "GET") { send(store.exportOutcomes(url.searchParams.get("cursor")), 200); return; }
      if (url.pathname === "/mcp" && request.method === "POST") {
        const rpc = await body(request);
        if (rpc.jsonrpc !== "2.0") throw new KitError("INVALID_RPC", "JSON-RPC 2.0 is required.", 400);
        if (typeof rpc.method === "string" && rpc.method.startsWith("notifications/") && rpc.id === undefined) { response.writeHead(202); response.end(); return; }
        if (typeof rpc.id !== "string" && !Number.isInteger(rpc.id)) throw new KitError("INVALID_RPC", "Requests need a string or integer ID.", 400);
        let result;
        const schema = { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, model: { type: "string", enum: ["first_touch", "last_touch", "last_non_direct"] } }, required: ["from", "to"], additionalProperties: false };
        if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "PipelineOn Open Attribution", version: packageInfo.version }, instructions: "Report observed evidence and missing coverage. Revenue is completed payments, never predicted sales. Tools are read-only; no messages or ad conversions are sent." };
        else if (rpc.method === "ping") result = {};
        else if (rpc.method === "tools/list") result = { tools: [
          ["get_attribution_report", "Read revenue, outcomes and source attribution."], ["check_tracking_health", "Diagnose stored traffic and outcome evidence."], ["get_unconverted_browsers", "Review browsers without recorded conversions; this does not identify people."],
          ["get_meta_delivery_receipts", "Read requested Meta deliveries and receipts. Acceptance is not ad attribution. Does not send or retry events."]
        ].map(([name, description]) => ({ name, description, inputSchema: name === "get_meta_delivery_receipts" ? { type: "object", properties: {}, additionalProperties: false } : schema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) };
        else if (rpc.method === "tools/call") {
          const name = rpc.params?.name;
          if (!["get_attribution_report", "check_tracking_health", "get_unconverted_browsers", "get_meta_delivery_receipts"].includes(name)) { send({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32602, message: "Unknown tool" } }, 200); return; }
          try {
            let value;
            if (name === "get_meta_delivery_receipts") {
              if (Object.keys(object(rpc.params?.arguments ?? {}, "Arguments")).length) throw new KitError("INVALID_INPUT", "This tool takes no arguments.", 400);
              value = store.meta.list();
            } else {
              const range = reportRange(rpc.params?.arguments, now);
              value = name === "get_unconverted_browsers" ? store.recovery(range) : name === "check_tracking_health" ? store.report(range, now).doctor : store.report(range, now);
            }
            result = { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
          } catch (error) {
            if (!(error instanceof KitError)) throw error;
            result = { isError: true, content: [{ type: "text", text: error.message }] };
          }
        } else { send({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: "Method not found" } }, 200); return; }
        send({ jsonrpc: "2.0", id: rpc.id ?? null, result }, 200); return;
      }
      throw new KitError("NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof KitError) { if (error.status === 429) response.setHeader("Retry-After", "60"); send({ error: { code: error.code, message: error.message } }, error.status); }
      else { console.error("Attribution kit request failed:", error instanceof Error ? error.name : "UnknownError"); send({ error: { code: "INTERNAL_ERROR", message: "The request failed. Check server health." } }, 500); }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const timer = meta && meta.mode !== "disabled" && config.metaAutoStart !== false ? setInterval(() => {
    flushMeta().catch(() => console.warn("[WARN] Meta worker failed; durable leases will be recovered. Inspect delivery status."));
  }, 5000) : null;
  timer?.unref();
  const callrailTimer = callrail && config.callrailAutoStart !== false ? setInterval(() => {
    flushCallrail().catch(() => console.warn("[WARN] CallRail worker failed; inspect durable call receipts."));
  }, 5000) : null;
  callrailTimer?.unref();
  const googleTimer = googleAds && googleAds.mode !== "disabled" && config.googleAutoStart !== false ? setInterval(() => {
    flushGoogle().catch(() => console.warn("[WARN] Google worker failed; durable leases will be recovered. Inspect delivery status."));
  }, 5000) : null;
  googleTimer?.unref();
  return { server, store, flushMeta, flushGoogle, flushCallrail, close: async () => {
    if (timer) clearInterval(timer);
    if (callrailTimer) clearInterval(callrailTimer);
    if (googleTimer) clearInterval(googleTimer);
    await new Promise((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); server.closeIdleConnections(); });
    try { await Promise.all([pendingFlush, pendingGoogle, pendingCallrail]); } finally { store.close(); }
  } };
}
