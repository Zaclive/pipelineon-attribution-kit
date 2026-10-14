import { randomUUID } from "node:crypto";
import { KitError, object, textValue, resolvePersonSessions } from "../core/index.mjs";

export function openPersonStore(db, transaction, audit) {
  db.exec(`CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS person_sources(source TEXT PRIMARY KEY,provider TEXT NOT NULL,account_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS person_contacts(provider TEXT NOT NULL,account_id TEXT NOT NULL,contact_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),PRIMARY KEY(provider,account_id,contact_id));
    CREATE INDEX IF NOT EXISTS person_contacts_person ON person_contacts(person_id);
    CREATE TABLE IF NOT EXISTS person_claims(source TEXT NOT NULL,external_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),session_id TEXT NOT NULL REFERENCES sessions(id),contact_id TEXT NOT NULL,occurred_at TEXT NOT NULL,linked_at TEXT NOT NULL,PRIMARY KEY(source,external_id),FOREIGN KEY(source,external_id) REFERENCES outcomes(source,external_id));
    CREATE INDEX IF NOT EXISTS person_claims_session ON person_claims(session_id,person_id);
    CREATE INDEX IF NOT EXISTS person_claims_person ON person_claims(person_id,occurred_at);`);
  function linkHubSpot(raw, now) {
    const input = object(raw, "Identity link");
    if (Object.keys(input).some(key => !["accountId", "contactId", "source", "externalId"].includes(key))) throw new KitError("INVALID_INPUT", "Unsupported identity field.", 400);
    const accountId = textValue(input.accountId, "accountId", 32), contactId = textValue(input.contactId, "contactId", 32);
    if (!/^[0-9]+$/.test(accountId) || !/^[0-9]+$/.test(contactId)) throw new KitError("INVALID_INPUT", "Use numeric HubSpot portal and contact IDs.", 400);
    const source = textValue(input.source, "source", 64), externalId = textValue(input.externalId, "externalId", 200);
    return transaction(() => {
      const rawEvent = db.prepare("SELECT payload FROM outcomes WHERE source=? AND external_id=?").get(source, externalId);
      const event = rawEvent ? JSON.parse(rawEvent.payload) : null;
      if (!event || event.deleted || event.eventType !== "form" || event.outcome !== "received" || event.contactIds.length !== 1 || event.contactIds[0] !== contactId ||
        !event.visitorSessionId || !db.prepare("SELECT id FROM sessions WHERE id=?").get(event.visitorSessionId))
        throw new KitError("IDENTITY_EVIDENCE_REQUIRED", "Import a verified enquiry with one CRM contact and an accepted visitor session first.", 422);
      const binding = db.prepare("SELECT account_id FROM person_sources WHERE source=?").get(source);
      if (binding && binding.account_id !== accountId) throw new KitError("IDENTITY_CONFLICT", "This outcome source belongs to another portal. Use one source per portal.", 409);
      db.prepare("INSERT OR IGNORE INTO person_sources VALUES(?,?,?)").run(source, "hubspot", accountId);
      let alias = db.prepare("SELECT person_id FROM person_contacts WHERE provider='hubspot' AND account_id=? AND contact_id=?").get(accountId, contactId);
      if (!alias) {
        alias = { person_id: randomUUID() };
        db.prepare("INSERT INTO people VALUES(?,?)").run(alias.person_id, now);
        db.prepare("INSERT INTO person_contacts VALUES('hubspot',?,?,?)").run(accountId, contactId, alias.person_id);
      }
      const existing = db.prepare("SELECT * FROM person_claims WHERE source=? AND external_id=?").get(source, externalId);
      if (existing) {
        if (existing.person_id !== alias.person_id || existing.session_id !== event.visitorSessionId || existing.occurred_at !== event.occurredAt)
          throw new KitError("IDENTITY_CONFLICT", "The enquiry identity evidence changed. Review the link rather than merging people.", 409);
        return { personId: alias.person_id, duplicate: true };
      }
      db.prepare("INSERT INTO person_claims VALUES(?,?,?,?,?,?,?)").run(source, externalId, alias.person_id, event.visitorSessionId, contactId, event.occurredAt, now);
      audit("person_browser_linked", `${source}:${externalId}`, now);
      return { personId: alias.person_id, duplicate: false };
    });
  }
  function resolve(event, cache) {
    if (event.contactIds.length !== 1) return null;
    const alias = db.prepare(`SELECT c.person_id,c.provider,c.account_id,c.contact_id FROM person_sources s JOIN person_contacts c
      ON c.provider=s.provider AND c.account_id=s.account_id WHERE s.source=? AND c.contact_id=?`).get(event.source, event.contactIds[0]);
    let rows = cache?.claims;
    if (!rows) {
      rows = db.prepare(`SELECT c.person_id AS personId,c.session_id AS visitorSessionId,c.occurred_at AS occurredAt
      FROM person_claims c JOIN outcomes o ON o.source=c.source AND o.external_id=c.external_id
      WHERE json_extract(o.payload,'$.deleted')=0 AND json_extract(o.payload,'$.eventType')='form'
      AND json_extract(o.payload,'$.outcome')='received' AND json_array_length(o.payload,'$.contactIds')=1
      AND json_extract(o.payload,'$.contactIds[0]')=c.contact_id AND o.session_id=c.session_id AND o.occurred_at=c.occurred_at
      ORDER BY c.source,c.external_id LIMIT 5001`).all();
      const historical = db.prepare(`SELECT COALESCE(a.person_id,'unregistered:hubspot:'||s.account_id||':'||json_extract(o.payload,'$.contactIds[0]')) AS personId,
        o.session_id AS visitorSessionId,o.occurred_at AS occurredAt FROM outcomes o
        JOIN person_sources s ON s.source=o.source JOIN sessions v ON v.id=o.session_id
        LEFT JOIN person_claims c ON c.source=o.source AND c.external_id=o.external_id
        LEFT JOIN person_contacts a ON a.provider=s.provider AND a.account_id=s.account_id AND a.contact_id=json_extract(o.payload,'$.contactIds[0]')
        WHERE c.source IS NULL AND json_extract(o.payload,'$.deleted')=0 AND json_extract(o.payload,'$.eventType')='form'
        AND json_extract(o.payload,'$.outcome')='received' AND json_array_length(o.payload,'$.contactIds')=1
        ORDER BY o.source,o.external_id LIMIT 5001`).all();
      rows.push(...historical);
    }
    if (cache) cache.claims = rows;
    if (!alias) {
      if (event.visitorSessionId && new Set(rows.filter(row => row.visitorSessionId === event.visitorSessionId).map(row => row.personId)).size > 1)
        return { status: "ambiguous", sessionIds: [] };
      return null;
    }
    const resolved = resolvePersonSessions(alias.person_id, rows, event.occurredAt);
    return { person: { id: alias.person_id, provider: alias.provider, accountId: alias.account_id, contactId: alias.contact_id, browserCount: resolved.sessionIds.length },
      status: rows.length > 5000 ? "history_limited" : resolved.status, sessionIds: rows.length > 5000 ? [] : resolved.sessionIds };
  }
  return { linkHubSpot, resolve };
}
