# Capabilities, requirements and evidence

| Capability | Included | Requirement / boundary |
| --- | --- | --- |
| Website visits and campaign capture | One consented pixel, SPA path/query and common #/ or #!/ routes | Script must load and collection must be permitted/reachable |
| Browser fingerprints | Collector, site-scoped stored signatures, rule matcher and evidence report | Evaluation only; recovered identity/attribution lift unmeasured |
| Own person IDs | Accepted HubSpot enquiry links and several verified browser histories | Trusted server adapter and verified first-party evidence; no anonymous names/emails |
| Source attribution | Stored chronology and three credit models | Incomplete histories and ambiguous identities remain visible |
| Business outcomes | Enquiries, qualified leads, appointments, estimates, won jobs and payments | Source adapter supplies authoritative facts; no universal CRM OAuth |
| Revenue | Completed payments with original timestamps and currency | Won-job value is separate; no predictive LTV or universal duplicate-source detection |
| CallRail | Signed webhook/API refresh queue and optional browser bridge | Customer account, pools and keys; not a telephony service |
| Meta and Google | Optional server delivery, retries/deduplication and provider receipts | Customer credentials, consent/provenance, correct action and one sender; no guaranteed match or ROAS |
| Agent reporting | Read-only MCP/API and dashboard/export | Protected read access; deployment needs a separate coding environment |
| Hosting | Node/Docker with persistent SQLite | Owner operates it, or chooses PipelineOn; Worker proxy is optional |

Automated tests establish defined behavior, not universal accuracy. An installation is verified only to the receipts actually inspected. See [verification](verify.md) and [browser testing](browser-continuity.md). Recommended marketing wording: "Open attribution with inspectable browser matching, verified CRM links, revenue reporting and optional conversion feedback." Describe fingerprinting as evaluation until real-traffic accuracy is measured.

Not included: server cookie restoration, required custom-domain collection, a proprietary identity network, universal ad-blocker recovery, automated bidding, predicted LTV or an ROI guarantee. Existing CRM/API/advertising costs and provider approval requirements remain separate from the MIT licence.
