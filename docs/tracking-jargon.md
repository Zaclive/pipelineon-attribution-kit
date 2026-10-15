# What tracking terminology means

These names describe mechanisms, not automatic results. Competitor statements below are documented positioning; we have not audited their private matching algorithms or reproduced their performance claims.

| Term | Practical mechanism | This release |
| --- | --- | --- |
| Print tracking | Combine browser IDs, campaign context and known contact evidence; some systems add fingerprints | Own browser IDs/verified person links plus separate fingerprint evaluation |
| Identity graph / swarm | Relate identifiers and events; some vendors include proprietary external identity data | Site-owned person/browser/CRM links; no proprietary third-party identity network |
| Cookieless recognition | Infer continuity from browser/connection signals when storage is missing | Optional results from the consented signature collector; no promise of universal recognition or consent-free tracking |
| Server-side tracking | Ingest/process facts on a backend and send configured destinations from it | Persistent ingestion and outcome APIs; browser-originated activity still needs to reach the backend |
| AI training / conversion feedback | Send meaningful outcomes to ad platforms for their selected optimization goals | Opt-in Meta/Google delivery with durable queues and receipts; no custom bidding AI |
| Cross-device attribution | Join different browser histories through reliable shared identity evidence | Accepted first-party enquiries can link several browsers to one CRM contact; fingerprints alone do not do this |
| Long-funnel attribution | Retain acquisition history and connect later outcomes | Original-time cutoffs, enquiries/calls/bookings/payments and source history |
| Multi-touch | Observe multiple touches and choose a credit rule | First-touch, last-touch and last-non-direct; no causal/incrementality model |
| AI reporting / MCP | Give an assistant structured, authorized read access | Read-only report, tracking-health, browser-opportunity and Meta-receipt tools |
| Signal recovery / uplift | Observe events or connections another setup misses | Diagnostic candidate counts; not a conversion-lift or revenue-lift measurement |
| Bot intelligence | Evaluate automation/network/behavior hints | Fingerprint comparison is not a fraud engine; browser claims are untrusted |
| LTV prediction | Forecast future customer revenue from a validated model | Recorded payment revenue only; no predictive LTV model |

References checked 15 October 2026: [HYROS print tracking](https://hyros.com/updates/what-is-hyros/), [HYROS Swarm/feedback/MCP positioning](https://hyros.com/ad-tracking), [Tracklution fingerprinting](https://www.tracklution.com/learn/cookieless-tracking/solutions/), [TAGGRS request masking](https://taggrs.io/docs/server-side-tracking/enhanced-tracking-script), [Stape User ID](https://stape.io/helpdesk/documentation/user-id-power-up), [Mozilla fingerprinting](https://developer.mozilla.org/en-US/docs/Glossary/Fingerprinting).

More recorded conversions can mean improved measurement without additional customers. Attribution credit is not causation, server acceptance is not ad matching, and conversion uploads do not automatically change an ad set's optimization goal. Any claim of perfect accuracy, universal recognition or guaranteed ROI needs separate evidence. See [capabilities and limits](capabilities.md).
