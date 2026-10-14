import { randomUUID } from "node:crypto";
import { KitError } from "../core/index.mjs";
import { callrailHash } from "./callrail.mjs";

export function openCallrailStore(db, config, transaction, audit, importOutcome) {
  db.exec(`CREATE TABLE IF NOT EXISTS callrail_jobs (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, call_id TEXT NOT NULL, digest TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_at TEXT, lease_token TEXT, lease_until TEXT, fingerprint TEXT, revision TEXT,
    reason TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(company_id,call_id));
    CREATE INDEX IF NOT EXISTS callrail_due ON callrail_jobs(company_id,status,next_at);
  `);
  const version = config ? callrailHash(JSON.stringify(config)) : "disabled";
  function enqueue(callId, digest, now) {
    if (!config) throw new KitError("CALLRAIL_DISABLED", "CallRail is not configured.", 503);
    return transaction(() => {
      const old = db.prepare("SELECT * FROM callrail_jobs WHERE company_id=? AND call_id=?").get(config.companyId, callId);
      if (old?.digest === digest) return { accepted: true, duplicate: true, id: old.id };
      const id = old?.id ?? randomUUID();
      db.prepare(`INSERT INTO callrail_jobs(id,company_id,call_id,digest,status,next_at,reason,updated_at) VALUES(?,?,?,?,'queued',?,'awaiting_refresh',?)
        ON CONFLICT(company_id,call_id) DO UPDATE SET digest=excluded.digest,generation=generation+1,
        status='queued',attempts=0,next_at=excluded.next_at,lease_token=NULL,lease_until=NULL,reason='awaiting_refresh',updated_at=excluded.updated_at`)
        .run(id, config.companyId, callId, digest, now, now);
      audit("callrail_webhook_accepted", id, now);
      return { accepted: true, duplicate: false, id };
    });
  }
  function owned(job) { return db.prepare("SELECT * FROM callrail_jobs WHERE id=? AND lease_token=? AND generation=? AND status='processing'").get(job.id, job.leaseToken, job.generation); }
  async function claim(now) {
    if (!config) return null;
    return transaction(() => {
      const job = db.prepare(`SELECT * FROM callrail_jobs WHERE company_id=? AND
        ((status IN ('queued','retry') AND next_at<=?) OR (status='processing' AND lease_until<=?)) ORDER BY next_at,id LIMIT 1`).get(config.companyId, now, now);
      if (!job) return null;
      if (job.attempts >= 8) {
        db.prepare("UPDATE callrail_jobs SET status='failed',reason='retry_budget_exhausted',lease_token=NULL,lease_until=NULL,next_at=NULL,updated_at=? WHERE id=?").run(now, job.id);
        audit("callrail_refresh_failed", job.id, now);
        return null;
      }
      const leaseToken = randomUUID();
      db.prepare("UPDATE callrail_jobs SET status='processing',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?")
        .run(leaseToken, new Date(Date.parse(now) + 90000).toISOString(), now, job.id);
      audit("callrail_refresh_claimed", job.id, now);
      return { id: job.id, callId: job.call_id, leaseToken, generation: job.generation, connectionVersion: version };
    });
  }
  async function complete(job, incoming, now) {
    return transaction(() => {
      const current = owned(job);
      if (!current || current.lease_until <= now || job.connectionVersion !== version) return false;
      const event = { ...incoming };
      const linked = event.visitorSessionId && db.prepare("SELECT id FROM sessions WHERE id=?").get(event.visitorSessionId);
      if (event.visitorSessionId && !linked) { event.visitorSessionId = null; event.meta = { ...event.meta, consent: "denied", userData: {} }; }
      const { sourceUpdatedAt: ignored, ...stable } = event;
      void ignored;
      const fingerprint = callrailHash(JSON.stringify(stable));
      const revision = current.fingerprint === fingerprint ? current.revision : new Date(Math.max(Date.parse(now), Date.parse(current.revision ?? event.occurredAt) + 1)).toISOString();
      if (current.fingerprint !== fingerprint) {
        const receipt = importOutcome({ ...event, sourceUpdatedAt: revision }, now);
        if (receipt.status === "stale") throw new KitError("CALLRAIL_IMPORT_CONFLICT", "A newer import already owns this call. Check for another CallRail adapter before retrying.", 409);
      }
      const reason = linked ? "imported_linked" : "imported_unlinked";
      db.prepare("UPDATE callrail_jobs SET status='complete',reason=?,fingerprint=?,revision=?,lease_token=NULL,lease_until=NULL,next_at=NULL,updated_at=? WHERE id=?")
        .run(reason, fingerprint, revision, now, job.id);
      audit("callrail_call_imported", job.id, now);
      return true;
    });
  }
  async function fail(job, failure, now) {
    return transaction(() => {
      const current = owned(job);
      if (!current) return false;
      const retry = failure.retryable && current.attempts < 8;
      db.prepare("UPDATE callrail_jobs SET status=?,reason=?,next_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?")
        .run(retry ? "retry" : "failed", failure.reason, retry ? new Date(Date.parse(now) + Math.min(86400, Math.max(failure.retryAfterSeconds ?? 0, Math.min(3600, 60 * 2 ** (current.attempts - 1)))) * 1000).toISOString() : null, now, job.id);
      audit("callrail_refresh_failed", job.id, now);
      return true;
    });
  }
  function retry(id, now) {
    return transaction(() => {
      if (!config) throw new KitError("CALLRAIL_DISABLED", "CallRail is not configured.", 503);
      const result = db.prepare("UPDATE callrail_jobs SET status='queued',attempts=0,next_at=?,generation=generation+1,reason='manual_retry',updated_at=? WHERE id=? AND company_id=? AND status IN ('failed','complete','retry')").run(now, now, id, config.companyId);
      if (!result.changes) throw new KitError("CALLRAIL_NOT_RETRYABLE", "Call is unavailable or currently processing.", 409);
      audit("callrail_retry_requested", id, now);
      return { queued: true };
    });
  }
  function list() {
    return { configured: !!config, companyId: config?.companyId ?? null, cookieName: config?.cookieName ?? null, deliveryOwner: config?.deliveryOwner ?? null,
      calls: config ? db.prepare("SELECT id,call_id AS callId,status,attempts,reason,next_at AS nextAt,updated_at AS updatedAt FROM callrail_jobs WHERE company_id=? ORDER BY updated_at DESC,id LIMIT 50").all(config.companyId) : [] };
  }
  return { enqueue, claim, complete, fail, retry, list };
}
