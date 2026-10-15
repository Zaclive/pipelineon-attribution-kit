import { createHmac, randomBytes } from "node:crypto";
import { normalizeBrowserSignature, evaluateBrowserContinuity, continuityReport, CONTINUITY_DAYS } from "../core/browser-continuity.mjs";
export function openContinuityStore(db, audit) {
  db.exec(`CREATE TABLE IF NOT EXISTS continuity_key(id INTEGER PRIMARY KEY CHECK(id=1), secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS browser_signatures(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      signature TEXT NOT NULL, evaluated_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, evidence TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS browser_signatures_seen ON browser_signatures(last_seen_at);`);
  db.prepare("INSERT OR IGNORE INTO continuity_key VALUES(1,?)").run(randomBytes(32).toString("hex"));
  const key = db.prepare("SELECT secret FROM continuity_key WHERE id=1").get().secret;
  const cutoff = now => new Date(Date.parse(now) - CONTINUITY_DAYS * 86400000).toISOString();
  function capture(sessionId, raw, now) {
    const signature = normalizeBrowserSignature(raw);
    if (!signature) return;
    signature.components = Object.fromEntries(Object.entries(signature.components).map(([name,value]) =>
      [name,createHmac("sha256",key).update(name + "|" + value).digest("hex")]));
    db.prepare("DELETE FROM browser_signatures WHERE last_seen_at<?").run(cutoff(now));
    const existing = db.prepare("SELECT session_id FROM browser_signatures WHERE session_id=?").get(sessionId);
    if (existing) {
      db.prepare("UPDATE browser_signatures SET last_seen_at=?,signature=? WHERE session_id=?").run(now,JSON.stringify(signature),sessionId);
    } else {
      const rows = db.prepare("SELECT session_id,signature,last_seen_at FROM browser_signatures WHERE last_seen_at<=? ORDER BY last_seen_at DESC,session_id LIMIT 1001").all(now);
      const evidence = evaluateBrowserContinuity(signature,rows.slice(0,1000).map(row => ({ visitorSessionId:row.session_id, lastSeenAt:row.last_seen_at, signature:JSON.parse(row.signature) })),rows.length>1000);
      db.prepare("INSERT INTO browser_signatures VALUES(?,?,?,?,?)").run(sessionId,JSON.stringify(signature),now,now,JSON.stringify(evidence));
    }
    audit("browser_signature_observed",sessionId,now);
  }
  function report(range, now) {
    const expired = db.prepare("DELETE FROM browser_signatures WHERE last_seen_at<?").run(cutoff(now));
    if (expired.changes) audit("browser_signatures_expired",String(expired.changes),now);
    const rows = db.prepare("SELECT session_id,evaluated_at,last_seen_at,evidence FROM browser_signatures WHERE last_seen_at>=? AND evaluated_at>=? AND evaluated_at<? ORDER BY evaluated_at DESC,session_id LIMIT 101")
      .all(cutoff(now),range.from,range.to);
    return continuityReport(rows.slice(0,100).map(row=>({ visitorSessionId:row.session_id,evaluatedAt:row.evaluated_at,lastSeenAt:row.last_seen_at,evidence:JSON.parse(row.evidence) })),rows.length>100);
  }
  return { capture, report };
}
