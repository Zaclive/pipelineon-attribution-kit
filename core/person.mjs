// A person is a site-owned record, not a cookie, IP, campaign or provider guess.
// Claims are supplied by a trusted adapter after validating a genuine enquiry.
export function resolvePersonSessions(personId, claims, cutoffAt) {
  const cutoff = Date.parse(cutoffAt);
  if (!personId || !Number.isFinite(cutoff)) return { status: "unlinked", personId: null, sessionIds: [] };
  const eligible = claims.filter(row => row.personId === personId && Date.parse(row.occurredAt) <= cutoff);
  const ids = [...new Set(eligible.map(row => row.visitorSessionId))].sort();
  const shared = ids.some(id => new Set(claims.filter(row => row.visitorSessionId === id).map(row => row.personId)).size > 1);
  if (shared) return { status: "ambiguous", personId, sessionIds: [] };
  return { status: ids.length ? "linked" : "unlinked", personId, sessionIds: ids };
}

export function summarizePeople(rows) {
  const people = new Map();
  for (const row of rows) {
    const person = row.attribution?.person;
    if (!person || !row.occurredAt) continue;
    const previous = people.get(person.id);
    const current = { ...person, activities: (previous?.activities ?? 0) + 1, occurredAt: row.occurredAt,
      status: row.attribution.status, touches: row.attribution.touches };
    if (!previous || Date.parse(row.occurredAt) >= Date.parse(previous.occurredAt)) people.set(person.id, current);
    else previous.activities++;
  }
  // Each summary is the person's latest outcome snapshot in this report.
  // Do not union touches from later outcomes into an earlier conversion.
  return [...people.values()].sort((a,b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)).slice(0, 100);
}
