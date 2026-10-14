import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { KitError, safePage, sessionReference, timestamp, validateOutcome, buildTouches, buildReport, summarizePeople, trackingDoctor } from "../core/index.mjs";
import { openPersonStore } from "./person-store.mjs";
import { openCallrailStore } from "./callrail-store.mjs";
import { openMetaStore } from "./meta-store.mjs";
import { openGoogleStore } from "./google-store.mjs";

export function openStore(filename, siteId, metaDestination, callrailConfig, googleDestination) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), site_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), occurred_at TEXT NOT NULL, url TEXT NOT NULL, referrer TEXT, payload_hash TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS visits_time ON visits(occurred_at);
    CREATE INDEX IF NOT EXISTS visits_session ON visits(session_id, occurred_at);
    CREATE TABLE IF NOT EXISTS outcomes (source TEXT NOT NULL, external_id TEXT NOT NULL, occurred_at TEXT NOT NULL, updated_at TEXT NOT NULL, session_id TEXT, payload TEXT NOT NULL, PRIMARY KEY(source,external_id));
    CREATE INDEX IF NOT EXISTS outcomes_time ON outcomes(occurred_at);
    CREATE INDEX IF NOT EXISTS outcomes_session ON outcomes(session_id);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, action TEXT NOT NULL, object_hash TEXT NOT NULL);
  `);
  const configured = db.prepare("SELECT site_id FROM config WHERE id=1").get();
  if (configured && configured.site_id !== siteId) { db.close(); throw new KitError("SITE_MISMATCH", "This database belongs to a different site. Use a separate database.", 500); }
  db.prepare("INSERT OR IGNORE INTO config(id,site_id) VALUES(1,?)").run(siteId);
  const hash = value => createHash("sha256").update(value).digest("hex");
  const audit = (action, id, now) => db.prepare("INSERT INTO audit(occurred_at,action,object_hash) VALUES(?,?,?)").run(now, action, hash(id));
  let inTransaction = false;
  function transaction(run) {
    if (inTransaction) return run();
    db.exec("BEGIN IMMEDIATE");
    inTransaction = true;
    try { const result = run(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    finally { inTransaction = false; }
  }
  const meta = openMetaStore(db, siteId, metaDestination, transaction, audit);
  const googleAds = openGoogleStore(db, siteId, googleDestination, transaction, audit);
  const people = openPersonStore(db, transaction, audit);
  function collect(input, origin, now) {
    if (input.siteId !== siteId) throw new KitError("NOT_FOUND", "Website not available.", 404);
    const visitor = sessionReference(input.visitorId);
    const id = sessionReference(input.eventId);
    if (!visitor || !id) throw new KitError("INVALID_INPUT", "visitorId and eventId are required UUIDs.", 400);
    const at = timestamp(input.occurredAt, "occurredAt");
    if (Date.parse(at) > Date.parse(now) + 300000 || Date.parse(at) < Date.parse(now) - 7 * 86400000) throw new KitError("INVALID_INPUT", "Visit time is outside the accepted seven-day window.", 400);
    const page = safePage(input.url);
    if (!page || page.origin !== origin) throw new KitError("INVALID_INPUT", "Page origin does not match the request origin.", 400);
    const referrer = safePage(input.referrer)?.origin ?? null;
    const digest = hash(JSON.stringify([visitor, at, page.url, referrer]));
    return transaction(() => {
      const existing = db.prepare("SELECT session_id,payload_hash FROM visits WHERE id=?").get(id);
      if (existing) {
        if (existing.payload_hash !== digest) throw new KitError("IDEMPOTENCY_CONFLICT", "This event ID already has different data.", 409);
        return { visitorSessionId: existing.session_id, duplicate: true };
      }
      let session = db.prepare("SELECT id FROM sessions WHERE visitor_id=?").get(visitor);
      if (!session) {
        session = { id: randomUUID() };
        db.prepare("INSERT INTO sessions(id,visitor_id,created_at) VALUES(?,?,?)").run(session.id, visitor, now);
      }
      db.prepare("INSERT INTO visits VALUES(?,?,?,?,?,?)").run(id, session.id, at, page.url, referrer, digest);
      audit("visit_collected", id, now);
      return { visitorSessionId: session.id, duplicate: false };
    });
  }
  function importOutcome(raw, now) {
    const event = validateOutcome(raw);
    if (Date.parse(event.sourceUpdatedAt) > Date.parse(now) + 300000) throw new KitError("INVALID_INPUT", "Source update is in the future.", 400);
    const payload = JSON.stringify(event);
    return transaction(() => {
      const previous = db.prepare("SELECT updated_at,payload FROM outcomes WHERE source=? AND external_id=?").get(event.source, event.externalId);
      if (previous) {
        if (previous.updated_at > event.sourceUpdatedAt) return { status: "stale", externalId: event.externalId };
        if (previous.updated_at === event.sourceUpdatedAt) {
          if (previous.payload !== payload) throw new KitError("VERSION_CONFLICT", "Different data has the same source update time. Supply a newer sourceUpdatedAt for a correction.", 409);
          return { status: "duplicate", externalId: event.externalId };
        }
      }
      db.prepare(`INSERT INTO outcomes VALUES(?,?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET
        occurred_at=excluded.occurred_at,updated_at=excluded.updated_at,session_id=excluded.session_id,payload=excluded.payload`)
        .run(event.source, event.externalId, event.occurredAt, event.sourceUpdatedAt, event.visitorSessionId, payload);
      audit("outcome_imported", `${event.source}:${event.externalId}`, now);
      meta.capture(event, now);
      googleAds.capture(event, now);
      return { status: previous ? "updated" : "created", externalId: event.externalId };
    });
  }
  function report(range, now) {
    const raw = db.prepare("SELECT payload FROM outcomes WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at,source,external_id LIMIT 100001").all(range.from, range.to);
    if (raw.length > 100000) throw new KitError("REPORT_TOO_LARGE", "This period has too much evidence for one report. Choose a shorter period; no partial totals were returned.", 422);
    const events = raw.map(row => JSON.parse(row.payload));
    const identityCache = {};
    const identity = new Map(events.map(event => [`${event.source}:${event.externalId}`, people.resolve(event, identityCache)]));
    const histories = new Map();
    for (const event of events) {
      const person = identity.get(`${event.source}:${event.externalId}`);
      if (person) {
        if (!person.person) continue;
        const key = person.person.id + ":" + person.sessionIds.join(",");
        if (histories.has(key)) continue;
        if (person.status !== "linked") { histories.set(key, null); continue; }
        if (person.sessionIds.length > 50) { histories.set(key, "limited"); continue; }
        const pages = db.prepare(`SELECT id,url,referrer,occurred_at AS occurredAt,session_id AS visitorId FROM visits
          WHERE session_id IN (${person.sessionIds.map(() => "?").join(",")}) AND occurred_at<? ORDER BY occurred_at,id LIMIT 5001`).all(...person.sessionIds, range.to);
        histories.set(key, pages.length > 5000 ? "limited" : pages);
        continue;
      }
      if (!event.visitorSessionId || histories.has(event.visitorSessionId)) continue;
      const session = db.prepare("SELECT id FROM sessions WHERE id=?").get(event.visitorSessionId);
      if (!session) { histories.set(event.visitorSessionId, null); continue; }
      const pages = db.prepare("SELECT id,url,referrer,occurred_at AS occurredAt,session_id AS visitorId FROM visits WHERE session_id=? AND occurred_at<? ORDER BY occurred_at,id LIMIT 5001").all(session.id, range.to);
      histories.set(event.visitorSessionId, pages.length > 5000 ? "limited" : pages);
    }
    const attributed = events.map(event => {
      const identityLink = identity.get(`${event.source}:${event.externalId}`);
      const person = identityLink?.person;
      if (identityLink && identityLink.status !== "linked") return { ...event, attribution: { status: identityLink.status, evidence: null, touches: null, person } };
      const history = histories.get(identityLink ? person.id + ":" + identityLink.sessionIds.join(",") : event.visitorSessionId);
      if (identityLink && history === "limited") return { ...event, attribution: { status: "history_limited", evidence: "person_identity", touches: null, person } };
      if (identityLink && history) {
        const touches = buildTouches(history, event.occurredAt);
        return { ...event, attribution: { status: touches.firstTouch ? "linked" : "unlinked", evidence: "person_identity", touches, person } };
      }
      if (!history) return { ...event, attribution: { status: event.visitorSessionId ? "session_unavailable" : "unlinked", evidence: null, touches: null } };
      if (history === "limited") return { ...event, attribution: { status: "history_limited", evidence: "session_reference", touches: null } };
      const touches = buildTouches(history, event.occurredAt);
      return { ...event, attribution: { status: touches.firstTouch ? "linked" : "unlinked", evidence: "session_reference", touches } };
    });
    const coverage = { limited: false, inspected: events.length, limit: 100000 };
    const result = buildReport(attributed, range, coverage);
    const pages = db.prepare("SELECT url,occurred_at FROM visits WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at DESC LIMIT 1000").all(range.from, range.to);
    const telemetry = { lastPageviewAt: pages[0]?.occurred_at ?? null, taggedPageviews: pages.filter(row => Object.keys(safePage(row.url)?.parameters ?? {}).length > 0).length, checkedAt: now };
    return { siteId, report: result, people: summarizePeople(attributed), doctor: trackingDoctor(result, telemetry), telemetry };
  }
  function recovery(range) {
    // Browser-level opportunities only. This does not identify people or establish outreach eligibility.
    const rows = db.prepare(`SELECT s.id,COUNT(*) AS pageviews,MAX(v.occurred_at) AS lastSeenAt FROM sessions s JOIN visits v ON v.session_id=s.id
      WHERE v.occurred_at>=? AND v.occurred_at<? AND NOT EXISTS(SELECT 1 FROM outcomes o WHERE o.session_id=s.id
        AND json_extract(o.payload,'$.deleted')=0 AND json_extract(o.payload,'$.eventType') IN ('form','call','booking','payment')
        AND json_extract(o.payload,'$.outcome') IN ('received','completed'))
      GROUP BY s.id ORDER BY pageviews DESC,lastSeenAt DESC,s.id LIMIT 101`).all(range.from, range.to);
    return { browsers: rows.slice(0, 100).map(row => ({ visitorSessionId: row.id, pageviews: row.pageviews, lastSeenAt: row.lastSeenAt })), limited: rows.length > 100,
      explanation: "Tracked browsers without a recorded successful form, call, booking or payment. Missing CRM data can create false gaps. No identities, predictions, contact permission or automated outreach are implied." };
  }
  function exportOutcomes(cursor) {
    const offset = Number(cursor ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw new KitError("INVALID_INPUT", "Invalid cursor.", 400);
    const rows = db.prepare("SELECT payload FROM outcomes ORDER BY source,external_id LIMIT 501 OFFSET ?").all(offset);
    return { records: rows.slice(0, 500).map(row => JSON.parse(row.payload)), nextCursor: rows.length > 500 ? String(offset + 500) : null,
      consistency: "Pause imports during a full export to keep pagination consistent." };
  }
  const callrail = openCallrailStore(db, callrailConfig, transaction, audit, importOutcome);
  return { collect, importOutcome, report, recovery, exportOutcomes, people, meta, callrail, googleAds, close: () => db.close() };
}
