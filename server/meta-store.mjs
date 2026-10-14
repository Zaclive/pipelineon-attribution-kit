import { randomUUID } from "node:crypto";
import { KitError, META_MAX_ATTEMPTS, META_RETRY_WINDOW_MS } from "../core/index.mjs";

export function openMetaStore(db, siteId, destination, transaction, audit) {
  db.exec(`CREATE TABLE IF NOT EXISTS meta_jobs (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, lease_token TEXT, lease_until TEXT,
    first_attempt_at TEXT, snapshot TEXT, identity TEXT UNIQUE, reason TEXT NOT NULL,
    source_changed INTEGER NOT NULL DEFAULT 0, receipt TEXT, updated_at TEXT NOT NULL,
    UNIQUE(source,external_id));
    CREATE INDEX IF NOT EXISTS meta_jobs_due ON meta_jobs(next_at) WHERE status IN ('queued','retry','processing');
    CREATE TABLE IF NOT EXISTS meta_attempts (
      job_id TEXT NOT NULL REFERENCES meta_jobs(id), attempt INTEGER NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, receipt TEXT, PRIMARY KEY(job_id,attempt));`);
  function capture(outcome, now) {
    const existing = db.prepare("SELECT * FROM meta_jobs WHERE source=? AND external_id=?").get(outcome.source, outcome.externalId);
    if (!outcome.meta && !existing) return;
    if (!existing) db.prepare("INSERT INTO meta_jobs(id,source,external_id,status,next_at,reason,updated_at) VALUES(?,?,?,'queued',?,'awaiting_delivery',?)")
      .run(randomUUID(), outcome.source, outcome.externalId, now, now);
    else if (existing.attempts === 0) db.prepare("UPDATE meta_jobs SET status='queued',next_at=?,lease_token=NULL,lease_until=NULL,reason='awaiting_delivery',updated_at=? WHERE id=?").run(now, now, existing.id);
    else db.prepare("UPDATE meta_jobs SET source_changed=1,updated_at=? WHERE id=?").run(now, existing.id);
    audit("meta_outcome_captured", existing?.id ?? `${outcome.source}:${outcome.externalId}`, now);
  }
  function claim(now) {
    if (!destination || destination.mode === "disabled") return null;
    return transaction(() => {
      const row = db.prepare(`SELECT j.*,o.payload FROM meta_jobs j JOIN outcomes o ON o.source=j.source AND o.external_id=j.external_id
        WHERE (j.status IN ('queued','retry') AND j.next_at<=?) OR (j.status='processing' AND j.lease_until<=?)
        ORDER BY j.next_at,j.id LIMIT 1`).get(now, now);
      if (!row) return null;
      const token = randomUUID();
      db.prepare("UPDATE meta_jobs SET status='processing',lease_token=?,lease_until=?,updated_at=? WHERE id=?")
        .run(token, new Date(Date.parse(now) + 90000).toISOString(), now, row.id);
      if (row.status === "processing" && row.attempts > 0) db.prepare("UPDATE meta_attempts SET finished_at=?,receipt=? WHERE job_id=? AND attempt=? AND finished_at IS NULL")
        .run(now, JSON.stringify({ accepted: false, reason: "worker_interrupted", retryable: true }), row.id, row.attempts);
      audit("meta_delivery_claimed", row.id, now);
      return { id: row.id, leaseToken: token, siteId, outcome: JSON.parse(row.payload), destination,
        snapshot: row.snapshot ? JSON.parse(row.snapshot) : null, attempts: row.attempts, firstAttemptAt: row.first_attempt_at };
    });
  }
  function begin(job, snapshot, now) {
    return transaction(() => {
      const row = db.prepare("SELECT j.*,o.payload FROM meta_jobs j JOIN outcomes o ON o.source=j.source AND o.external_id=j.external_id WHERE j.id=? AND j.lease_token=? AND j.status='processing'")
        .get(job.id, job.leaseToken);
      if (!row) return null;
      if (JSON.parse(row.payload).sourceUpdatedAt !== job.outcome.sourceUpdatedAt) {
        db.prepare("UPDATE meta_jobs SET status='queued',next_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, now, job.id);
        audit("meta_delivery_source_changed", job.id, now);
        return null;
      }
      const collision = db.prepare("SELECT id FROM meta_jobs WHERE identity=? AND id<>?").get(snapshot.identity, job.id);
      if (collision) {
        db.prepare("UPDATE meta_jobs SET status='blocked',reason='event_identity_conflict',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id);
        audit("meta_delivery_identity_conflict", job.id, now);
        return null;
      }
      if (row.attempts >= META_MAX_ATTEMPTS) {
        db.prepare("UPDATE meta_jobs SET status='review',reason='retry_budget_exhausted',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now, job.id);
        audit("meta_delivery_stopped", job.id, now);
        return null;
      }
      const attempts = row.attempts + 1;
      const firstAttemptAt = row.first_attempt_at ?? now;
      db.prepare("UPDATE meta_jobs SET attempts=?,snapshot=?,identity=?,first_attempt_at=?,reason='sending',source_changed=0,updated_at=? WHERE id=?")
        .run(attempts, JSON.stringify(snapshot), snapshot.identity, firstAttemptAt, now, job.id);
      db.prepare("INSERT INTO meta_attempts(job_id,attempt,started_at) VALUES(?,?,?)").run(job.id, attempts, now);
      audit("meta_delivery_attempted", job.id, now);
      return { ...job, snapshot, attempts, firstAttemptAt, accessToken: destination.accessToken };
    });
  }
  function finish(job, result, now) {
    return transaction(() => {
      const row = db.prepare("SELECT id FROM meta_jobs WHERE id=? AND lease_token=? AND status='processing'").get(job.id, job.leaseToken);
      if (!row) throw new KitError("META_LEASE_LOST", "Delivery lease changed; inspect the persisted receipt before retrying.", 409);
      db.prepare("UPDATE meta_jobs SET status=?,reason=?,next_at=?,lease_token=NULL,lease_until=NULL,receipt=coalesce(?,receipt),updated_at=? WHERE id=?")
        .run(result.status, result.reason, result.nextAttemptAt, result.receipt ? JSON.stringify(result.receipt) : null, now, job.id);
      if (result.receipt) db.prepare("UPDATE meta_attempts SET finished_at=?,receipt=? WHERE job_id=? AND attempt=?")
        .run(now, JSON.stringify(result.receipt), job.id, job.attempts);
      audit(`meta_delivery_${result.status}`, job.id, now);
    });
  }
  function retry(id, now) {
    return transaction(() => {
      const row = db.prepare("SELECT * FROM meta_jobs WHERE id=?").get(id);
      if (!row) throw new KitError("NOT_FOUND", "Delivery not found.", 404);
      if (!["failed", "blocked"].includes(row.status) || row.attempts >= META_MAX_ATTEMPTS ||
        (row.first_attempt_at && Date.parse(now) >= Date.parse(row.first_attempt_at) + META_RETRY_WINDOW_MS))
        throw new KitError("RETRY_UNSAFE", "This delivery cannot be retried safely. Inspect its receipt and source.", 409);
      db.prepare("UPDATE meta_jobs SET status='queued',reason='manual_retry',next_at=?,updated_at=? WHERE id=?").run(now, now, id);
      audit("meta_delivery_retry_requested", id, now);
      return { id, status: "queued" };
    });
  }
  function list() {
    const rows = db.prepare("SELECT * FROM meta_jobs ORDER BY updated_at DESC,id LIMIT 51").all();
    return { connection: destination ? { datasetId: destination.datasetId, mode: destination.mode, testEventCode: destination.testEventCode, configured: true } : { configured: false, mode: "disabled" },
      counts: Object.fromEntries(db.prepare("SELECT status,COUNT(*) AS count FROM meta_jobs GROUP BY status").all().map(row => [row.status, row.count])),
      deliveries: rows.slice(0, 50).map(row => {
        const snapshot = row.snapshot ? JSON.parse(row.snapshot) : null;
        return { id: row.id, source: row.source, externalId: row.external_id, status: row.status, reason: row.reason,
          attempts: row.attempts, nextAttemptAt: row.next_at, sourceChanged: Boolean(row.source_changed), updatedAt: row.updated_at,
          datasetId: snapshot?.datasetId ?? destination?.datasetId ?? null, mode: snapshot?.mode ?? null,
          eventId: snapshot?.eventId ?? null, eventName: snapshot?.eventName ?? null,
          receipt: row.receipt ? JSON.parse(row.receipt) : null,
          history: db.prepare("SELECT attempt,started_at AS startedAt,finished_at AS finishedAt,receipt FROM meta_attempts WHERE job_id=? ORDER BY attempt").all(row.id)
            .map(attempt => ({ ...attempt, receipt: attempt.receipt ? JSON.parse(attempt.receipt) : null })) };
      }), limited: rows.length > 50 };
  }
  return { capture, claim, begin, finish, retry, list };
}
