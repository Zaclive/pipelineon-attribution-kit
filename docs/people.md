# Own the person link and campaign history

PipelineOn keeps a site-owned person UUID independently of CRM traffic-source fields. A person can have several verified browser histories and a HubSpot portal/contact reference. Browser IDs, campaign IDs, IP addresses and provider guesses are not interchangeable person IDs. Anonymous visits stay browser-level until an accepted enquiry provides a link.

The kit stores the HubSpot portal and contact IDs directly on each person row. A separate table stores timestamped, verified browser links supported by accepted enquiries. It reuses the existing visits and outcomes tables for page views, campaigns, CRM stage changes and other events; it does not duplicate that history. Restarting the server or refreshing CRM data preserves person IDs. One database belongs to one site. Use a separate outcome `source` for each HubSpot portal; the same numeric contact ID in another portal is a different external identity.

Upgrading from v0.3.7 automatically moves the former CRM-reference rows onto people without changing person IDs or browser links. Back up the SQLite database first. An old person with several CRM references requires review rather than choosing one silently.

## Connect an accepted enquiry

Your trusted server-side adapter must first validate the real form submission, the customer-provided identity, website ownership, consent and accepted visitor-session reference. Correlate the enquiry with the CRM contact using exact permitted identity and submission evidence. Never expose the write token in the pixel, and never let a browser nominate an arbitrary CRM contact.

1. Import the accepted form through `POST /v1/outcomes`. Include its original `occurredAt`, accepted `visitorSessionId`, exactly one HubSpot contact ID in `contactIds`, and a stable enquiry `externalId`. Use a dedicated source such as `hubspot_main` for the portal.
2. Call `POST /v1/identities/hubspot` with the **write token** and this body:

```json
{"source":"hubspot_main","externalId":"enquiry-001","accountId":"123","contactId":"101"}
```

The server requires that saved enquiry and its accepted browser session. It returns a new or existing `personId`; replay is idempotent. Another verified enquiry for contact `101` in portal `123`, including one from a different browser, returns the same person ID. Source-to-portal bindings prevent accidental cross-account joins. This endpoint records a link in this kit; it does not connect OAuth, fetch HubSpot, create contacts or send conversions.

3. Import later CRM calls, bookings, job stages and payments with the same source and contact ID. They can resolve through the person link even when they have no browser session reference. Preserve actual occurrence timestamps. A won deal is not a payment.
4. Read `/v1/report`. Its `people` array contains person IDs, scoped CRM references, browser counts and first/latest/non-direct touches. The dashboard links to the CRM contact and shows the ordered campaign touches. These snapshots stop at each person's latest outcome in the selected report. The aggregate report still counts activities, not unique people.

## Boundaries and corrections

Each outcome uses only browser links evidenced by enquiries at or before that outcome and only visits at or before its original timestamp. Later visits do not rewrite earlier conversions. Several distinct campaigns are retained; changing the credit model does not change history. Raw safe tags and normalized values remain separate. Conflicting campaign values do not invalidate an otherwise accepted person link or delete the visit.

If different contacts claim the same browser, the records remain separate and that person's browser credit is marked ambiguous. The kit does not silently merge them. Corrected or removed enquiry evidence stops contributing to resolution. Changes to an existing claim require review rather than overwriting its original identity. Cookie deletion or a new device creates another browser history; it becomes part of a known person only after a verified enquiry links it. [Fingerprint evaluation](browser-continuity.md) may suggest a returning browser separately, but never creates this verified person link.

Person reports are read-token protected. The browser collection route cannot create person links. Reports retain the existing history limits: at most 50 browsers and 5,000 visits per attributed person, and 5,000 retained identity claims per kit. Exceeding a limit returns incomplete attribution rather than a successful partial match. Up to 100 person snapshots are exported, with up to 12 shown in the dashboard and 50 displayed touches per person. No names, email addresses or phone numbers are needed in the person-link tables.

## Test before launch

Visit as an anonymous browser through campaign A, return through campaign B, then submit an enquiry and link its CRM contact. Verify one persisted person ID, both campaign touches and the original timestamps. Repeat from a second browser with a verified enquiry for the same contact and verify the ID stays the same. Restart the server. Compare first-touch and last-touch reports: credit changes, person/history does not. Finally check shared-browser ambiguity, wrong portal/source rejection, missing enquiry rejection, outcome corrections and visits after the conversion cutoff.

HubSpot custom UTM properties are optional conveniences. [The custom-property mapper](hubspot-attribution.md) can copy a snapshot to HubSpot, but the person model and attribution report do not depend on it.
