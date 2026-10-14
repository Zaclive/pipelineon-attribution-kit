import { randomUUID } from "node:crypto";
import { KitError, GOOGLE_MAX_ATTEMPTS, GOOGLE_RETRY_WINDOW_MS } from "../core/index.mjs";

export function openGoogleStore(db, siteId, destination, transaction, audit) {
  db.exec(`CREATE TABLE IF NOT EXISTS google_jobs (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, polls INTEGER NOT NULL DEFAULT 0, request_id TEXT,
    next_at TEXT, lease_token TEXT, lease_until TEXT, first_attempt_at TEXT, snapshot TEXT,
    identity TEXT UNIQUE, reason TEXT NOT NULL, source_changed INTEGER NOT NULL DEFAULT 0,
    receipt TEXT, updated_at TEXT NOT NULL, UNIQUE(source,external_id));
    CREATE INDEX IF NOT EXISTS google_jobs_due ON google_jobs(next_at) WHERE status IN ('queued','retry','submitted','processing');
    CREATE TABLE IF NOT EXISTS google_attempts (
      job_id TEXT NOT NULL REFERENCES google_jobs(id), sequence INTEGER NOT NULL, phase TEXT NOT NULL,
      started_at TEXT NOT NULL, finished_at TEXT, receipt TEXT, PRIMARY KEY(job_id,sequence));`);
  function capture(outcome, now) {
    const old = db.prepare("SELECT * FROM google_jobs WHERE source=? AND external_id=?").get(outcome.source, outcome.externalId);
    if (!outcome.googleAds && !old) return;
    if (!old) db.prepare("INSERT INTO google_jobs(id,source,external_id,status,next_at,reason,updated_at) VALUES(?,?,?,'queued',?,'awaiting_delivery',?)")
      .run(randomUUID(), outcome.source, outcome.externalId, now, now);
    else if (!old.attempts) db.prepare("UPDATE google_jobs SET status='queued',next_at=?,lease_token=NULL,lease_until=NULL,reason='awaiting_delivery',updated_at=? WHERE id=?").run(now, now, old.id);
    else db.prepare("UPDATE google_jobs SET source_changed=1,updated_at=? WHERE id=?").run(now, old.id);
    audit("google_outcome_captured", old?.id ?? `${outcome.source}:${outcome.externalId}`, now);
  }
  function claim(now) {
    if (!destination || destination.mode === "disabled") return null;
    return transaction(() => {
      const row = db.prepare(`SELECT j.*,o.payload FROM google_jobs j JOIN outcomes o ON o.source=j.source AND o.external_id=j.external_id
        WHERE (j.status IN ('queued','retry','submitted') AND j.next_at<=?) OR (j.status='processing' AND j.lease_until<=?)
        ORDER BY j.next_at,j.id LIMIT 1`).get(now, now);
      if (!row) return null;
      const token = randomUUID();
      db.prepare("UPDATE google_jobs SET status='processing',lease_token=?,lease_until=?,updated_at=? WHERE id=?")
        .run(token, new Date(Date.parse(now) + 90000).toISOString(), now, row.id);
      if (row.status === "processing" && row.attempts + row.polls > 0) db.prepare("UPDATE google_attempts SET finished_at=?,receipt=? WHERE job_id=? AND sequence=? AND finished_at IS NULL")
        .run(now, JSON.stringify({ accepted: false, retryable: true, reason: "worker_interrupted" }), row.id, row.attempts + row.polls);
      audit("google_delivery_claimed", row.id, now);
      return { id: row.id, leaseToken: token, siteId, outcome: JSON.parse(row.payload), destination,
        snapshot: row.snapshot ? JSON.parse(row.snapshot) : null, attempts: row.attempts, polls: row.polls,
        requestId: row.request_id, firstAttemptAt: row.first_attempt_at };
    });
  }
  function begin(job, snapshot, now) {
    return transaction(() => {
      const row = db.prepare("SELECT j.*,o.payload FROM google_jobs j JOIN outcomes o ON o.source=j.source AND o.external_id=j.external_id WHERE j.id=? AND j.lease_token=? AND j.status='processing'")
        .get(job.id, job.leaseToken);
      if (!row) return null;
      if (JSON.parse(row.payload).sourceUpdatedAt !== job.outcome.sourceUpdatedAt) {
        db.prepare("UPDATE google_jobs SET status=?,next_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(row.request_id ? "submitted" : "queued", now, now, job.id); return null;
      }
      if (db.prepare("SELECT id FROM google_jobs WHERE identity=? AND id<>?").get(snapshot.identity, job.id)) {
        db.prepare("UPDATE google_jobs SET status='blocked',reason='event_identity_conflict',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id); return null;
      }
      if (!row.request_id && row.attempts >= GOOGLE_MAX_ATTEMPTS || row.request_id && row.polls >= 120) {
        db.prepare("UPDATE google_jobs SET status='review',reason='retry_budget_exhausted',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id); return null;
      }
      const attempts = row.attempts + (row.request_id ? 0 : 1), polls = row.polls + (row.request_id ? 1 : 0);
      const firstAttemptAt = row.first_attempt_at ?? now;
      db.prepare("UPDATE google_jobs SET attempts=?,polls=?,snapshot=?,identity=?,first_attempt_at=?,reason=?,source_changed=0,updated_at=? WHERE id=?")
        .run(attempts, polls, JSON.stringify(snapshot), snapshot.identity, firstAttemptAt, row.request_id ? "checking_processing" : "sending", now, job.id);
      db.prepare("INSERT INTO google_attempts(job_id,sequence,phase,started_at) VALUES(?,?,?,?)")
        .run(job.id, attempts + polls, row.request_id ? "status" : "ingest", now);
      audit("google_delivery_attempted", job.id, now);
      return { ...job, snapshot, attempts, polls, firstAttemptAt };
    });
  }
  function finish(job, result, now) {
    return transaction(() => {
      if (!db.prepare("SELECT id FROM google_jobs WHERE id=? AND lease_token=? AND status='processing'").get(job.id, job.leaseToken))
        throw new KitError("GOOGLE_LEASE_LOST", "Delivery lease changed. Inspect the persisted receipt before retrying.", 409);
      db.prepare("UPDATE google_jobs SET status=?,reason=?,next_at=?,lease_token=NULL,lease_until=NULL,receipt=coalesce(?,receipt),request_id=coalesce(?,request_id),updated_at=? WHERE id=?")
        .run(result.status, result.reason, result.nextAttemptAt, result.receipt ? JSON.stringify(result.receipt) : null, result.receipt?.requestId ?? null, now, job.id);
      if (result.receipt) db.prepare("UPDATE google_attempts SET finished_at=?,receipt=? WHERE job_id=? AND sequence=?")
        .run(now, JSON.stringify(result.receipt), job.id, job.attempts + job.polls);
      audit(`google_delivery_${result.status}`, job.id, now);
    });
  }
  function retry(id, now) {
    return transaction(() => {
      const row = db.prepare("SELECT * FROM google_jobs WHERE id=?").get(id);
      if (!row) throw new KitError("NOT_FOUND", "Google delivery not found.", 404);
      if (!["blocked", "failed"].includes(row.status) || row.attempts >= GOOGLE_MAX_ATTEMPTS || row.polls >= 120 ||
        row.first_attempt_at && Date.parse(now) >= Date.parse(row.first_attempt_at) + GOOGLE_RETRY_WINDOW_MS)
        throw new KitError("RETRY_UNSAFE", "Inspect the Google source and receipt before retrying.", 409);
      db.prepare("UPDATE google_jobs SET status=?,reason='manual_retry',next_at=?,updated_at=? WHERE id=?").run(row.request_id ? "submitted" : "queued", now, now, id);
      audit("google_delivery_retry_requested", id, now); return { id, status: row.request_id ? "submitted" : "queued" };
    });
  }
  function list() {
    const rows = db.prepare("SELECT * FROM google_jobs ORDER BY updated_at DESC,id LIMIT 51").all();
    return { connection: destination ? { ...destination, configured: true } : { mode: "disabled", configured: false },
      deliveries: rows.slice(0, 50).map(row => {
        const s = row.snapshot ? JSON.parse(row.snapshot) : null;
        return { id: row.id, source: row.source, externalId: row.external_id, status: row.status, reason: row.reason,
          attempts: row.attempts, polls: row.polls, requestId: row.request_id, nextAttemptAt: row.next_at,
          sourceChanged: Boolean(row.source_changed), updatedAt: row.updated_at, businessEvent: s?.businessEvent ?? null,
          accountId: s?.accountId ?? destination?.accountId ?? null, conversionActionId: s?.conversionActionId ?? null,
          transactionId: s?.transactionId ?? null, mode: s?.mode ?? null, receipt: row.receipt ? JSON.parse(row.receipt) : null,
          history: db.prepare("SELECT sequence,phase,started_at AS startedAt,finished_at AS finishedAt,receipt FROM google_attempts WHERE job_id=? ORDER BY sequence")
            .all(row.id).map(a => ({ ...a, receipt: a.receipt ? JSON.parse(a.receipt) : null })) };
      }), limited: rows.length > 50 };
  }
  return { capture, claim, begin, finish, retry, list };
}
