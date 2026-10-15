# Browser fingerprint evaluation

The pixel attempts to recognize possible returning browsers after their stored visitor ID disappears. It collects component hashes through the same consented script; no Fingerprint.com account or external identification agent is needed. This is evaluation mode: no person merges, source-credit changes, outreach or inferred advertising matching.

## Collected components

| Component | Inputs and limits |
| --- | --- |
| environment | Browser user-agent and platform; updates can change it |
| screen | Screen resolution, colour depth, pixel ratio; not a unique device serial |
| locale | Preferred language and timezone; common across many visitors |
| capabilities | Reported CPU concurrency and touch points; not a hardware inventory |
| canvas | Hash of one small fixed drawing; raw image is not transmitted |
| webgl | Hash of exposed GPU vendor/renderer and two limits; unavailable when the browser hides it |

No microphone/audio probe, installed-font enumeration, IP-based matching or hardware serial is included. Audio is deferred pending evidence that it adds stable discrimination. Browser collection has a 200 ms digest deadline; unavailable APIs and errors degrade to ordinary visit collection. The collector is embedded from one reviewed source in the modern, legacy and standalone pixels. Consent/GPC is checked before probing and again before sending. Nothing runs before collection consent, and withdrawal stops pending requests; it does not erase already stored history automatically.

Browser hashes are keyed again on the server. The standalone database has its own private persisted key, and hosted observations use a site/organization-scoped server key. No raw hash or signal value is exposed in the report. Hashing does not make tracking anonymous. Keep the database/key backups private; key rotation changes comparability. Never reuse signatures as global cross-site identities. Backups follow your own retention/deletion policy.

## Matching rules and report

Existing browser IDs remain authoritative for their own history. A new browser history is compared with up to 1,000 earlier signatures active in the last 30 days, within its own site. A candidate needs matching canvas and WebGL, at least five agreeing components and at least 9 of 11 rule points. Environment has weight 2, screen/locale/capabilities 1 each, canvas/WebGL 3 each. One browser update can be tolerated. These thresholds are an initial heuristic, not a measured probability or accuracy guarantee.

The first saved evaluation remains attached to that browser; later consented observations refresh its signature and last-seen time without rewriting its original explanation. Evaluation can say possible_return, ambiguous, no_match or history_limited. More than one qualifying browser stays ambiguous; exceeding the search limit prevents choosing a winner. At most five candidate explanations and 100 latest evaluations are returned. Counts describe that sample, not total traffic or measured tracking uplift. The dashboard shows 20 evaluations; exports/API return up to 100.

Open the Browser matching evidence section or read GET /v1/continuity with a read token. GET /v1/report includes the same continuity object; the hosted /api/attribution report includes it too. Inspect evaluation time, inspected count, matching/changed/unavailable component names and candidate browser session references. The score is not a percentage. Browser-supplied signals are spoofable and cannot authorize identity writes.

The 30-day window is eligibility since last observation. Expired profiles are removed during collection and maintenance; SQLite also prunes when its report is read. A quiet/offline deployment must still run maintenance. Database backups may retain older copies. Normal visit/outcome retention is separate.

## What this cannot establish

Identical devices can share signatures. Browser privacy protections can hide or randomize inputs. Driver/browser changes can lose a match. Shared computers can represent several people. A browser fingerprint cannot reveal a name, recover a missing campaign, connect a phone and laptop reliably, reverse consent withdrawal or prove an ad caused revenue. A unique candidate in our saved sample does not establish uniqueness across everyone on the internet.

## Evaluate before changing attribution

Use an isolated consented QA site. Record a browser, clear only its tracking storage, revisit and check for a candidate while confirming two distinct browser histories remain. Repeat after a network change and browser update. Test similar devices, absent WebGL, signature tampering, multiple candidates, limits, restart, GPC and withdrawal during hashing. Compare candidate results against controlled known browsers and accepted first-party enquiries, recording incorrect joins and missed returns as well as recovered candidates. Synthetic tests establish behavior; real-traffic precision and attribution lift remain unmeasured.

## Disable only fingerprint evaluation

Set data-po-browser-continuity="off" on the same script to retain ordinary consented visit tracking without fingerprint probes. Omitting it enables evaluation after consent. The hosted config exposes browserContinuity separately; fingerprint:null refers only to the disabled external Fingerprint.com integration.
