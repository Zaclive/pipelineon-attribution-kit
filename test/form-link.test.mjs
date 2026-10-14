import { test } from "node:test";
import assert from "node:assert/strict";
import { formIdentityEmails, matchFormVisit } from "../core/index.mjs";
const form = { siteId: "site", identityKey: "email-digest", url: "https://www.example.com/quote", occurredAt: "2026-10-14T01:00:00Z" };
const visit = { id: "diagnostic", siteId: "site", identityKeys: ["email-digest"], visitorSessionId: "session", url: "https://example.com/quote?utm_source=google", occurredAt: "2026-10-14T00:59:59Z" };
test("normalizes validated email fields without treating phone, secrets or arbitrary text as identity", () => {
  assert.deepEqual(formIdentityEmails({ email_address: [" Person@Example.com ", "person@example.com"], confirm_email: "person@example.com", phone: "123", notes: "other@example.com", email: "bad" }), ["person@example.com"]);
});
test("links confirmed forms by exact identity, website, page and time and collapses same-session retries", () => {
  assert.deepEqual(matchFormVisit(form, [visit, { ...visit, id: "retry", occurredAt: "2026-10-14T01:00:03Z" }]), { status: "linked", observationId: "diagnostic", visitorSessionId: "session" });
});
test("never chooses between different browsers or multiple identity keys", () => {
  assert.equal(matchFormVisit(form, [visit, { ...visit, id: "other", visitorSessionId: "different" }]).status, "ambiguous");
  assert.equal(matchFormVisit(form, [{ ...visit, identityKeys: ["email-digest", "different"] }]).status, "unlinked");
});
test("rejects cross-site, cross-host, different page, missing session, identity mismatch and stale observations", () => {
  for (const patch of [{ siteId: "other" }, { url: "https://evil.test/quote" }, { url: "https://example.com/other" }, { visitorSessionId: null }, { identityKeys: ["other"] }, { occurredAt: "2026-10-14T00:57:59Z" }])
    assert.equal(matchFormVisit(form, [{ ...visit, ...patch }]).status, "unlinked");
});
