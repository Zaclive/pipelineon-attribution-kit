# Preserve first and returning campaigns in HubSpot

Start with [our person and browser model](people.md). The kit owns person IDs and visit history, linked to a CRM contact independently of HubSpot's source fields. Copying custom properties into HubSpot is optional and is not required for attribution.

The kit exports `hubspotAttributionProperties(touches, existingProperties, visitorSessionId)` from `core/index.mjs`. It is a pure mapping helper, not an automatic HubSpot connection. Your server-side connector must perform the reads and writes. No paid HubSpot workflow is required by this helper; verify your account's custom-property allowance before setup.

Create the ten text properties listed by `HUBSPOT_ATTRIBUTION_PROPERTIES` on contacts. Use single-line text for the source, medium, campaign, campaign ID and session reference fields; use multiline text for `po_attribution`. This JSON field retains first touch, last touch, last non-direct touch, up to 50 observed touches, timestamps, raw safe UTMs and normalized UTMs. It explicitly marks incomplete history. Click IDs, IP addresses and page URLs are excluded from contact properties.

## Write sequence

1. Accept a genuine enquiry on your own server. Validate consent, website ownership, origin and the accepted visitor session reference. Do not trust attribution fields supplied by a browser.
2. Load the timestamped visits for that site and browser. Build touches using the enquiry's original event time as the cutoff, never the import time.
3. Locate the contact by the enquiry's customer-provided email. Read all ten existing properties before writing. Do not attach another person's cookie or use household guesses.
4. Serialize updates for this contact in a durable queue or lock, including retries. HubSpot contact updates are not a compare-and-swap operation; a read followed by a write alone cannot protect against concurrent writers.
5. Call the helper, then write the returned properties alongside the accepted enquiry. Never send a private app token from browser JavaScript. Use a stable submission ID and record a durable delivery receipt before attempting a write.
6. Read the contact back from HubSpot with all ten properties and compare it with the expected result. The receipt, saved contact, and linked PipelineOn outcome are separate checks.

Original fields are written as one snapshot only when the contact has no existing original evidence. Later visits do not fill blanks in that original snapshot. Latest fields are explicitly cleared when a direct return has no campaign. Last non-direct evidence stays separate. An older submission cannot replace a newer latest touch. Existing original fields without their JSON evidence require review rather than a guessed migration.

## Normalization and conflict rules

Keep raw saved URLs intact. The derived normalized values trim whitespace, lowercase source and medium, map `Google Ads`/`adwords` to `google`, `fb` to `facebook`, `ppc`/`paid-search` to `cpc`, and paid-social spelling variants to `paid_social`. Campaign names, IDs, content and keywords retain case; IDs remain strings. The normalizer does not repeatedly URL-decode values or guess campaign names from placeholders.

Within one visit, disagreeing ad campaign IDs such as `gad_campaignid` and `hsa_cam` remain an unresolved conflict. The helper does not choose a winner. UTM taxonomy IDs (`utm_id`, `utm_campaign_id`) and numeric `utm_campaign` names are separate evidence. Campaign A followed by campaign B is a normal two-touch journey, not an ID conflict.

## Acceptance test

Visit with campaign A and mixed-case source plus `PPC`; navigate internally; return through campaign B with a different ID; submit an enquiry. Read the contact back and verify original A, latest B, separate raw and normalized values, and both timestamped touches. Then make a direct return after 30 minutes of inactivity, submit a second enquiry, and verify original A remains, latest source is Direct with blank campaign, and last non-direct remains B. Verify all three attribution models separately. An immediate untagged internal navigation is not a new direct visit.

HubSpot's native traffic-source drill-down fields are automatically managed. This helper uses separate custom fields and does not replace those properties. See [HubSpot traffic-source properties](https://knowledge.hubspot.com/properties/understand-traffic-source-properties), [contact API](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide), and [Google Ads tracking templates](https://knowledge.hubspot.com/ads/track-and-report-on-google-ads-in-hubspot).
