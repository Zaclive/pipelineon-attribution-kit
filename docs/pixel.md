# Install the pixel and define conversion events

The pixel observes visits and returns a reference to carry into the CRM. Business outcomes arrive through your server or CRM adapter. The v0.3 pixel has no browser `track("Purchase")` or arbitrary custom-event API.

Installing through Google Tag Manager? Use [gtm guide](gtm.md). An optional Worker endpoint has its own [recipe](hosting.md#put-the-pixel-behind-an-optional-cloudflare-worker).

## Define what happened

| Action | Capture point | Meaning |
| --- | --- | --- |
| Page load or SPA navigation | Pixel | An observed visit and permitted campaign parameters. |
| Submit-button click | Optional separate website analytics | An attempt, not proof of a saved enquiry. |
| Successful form save | Backend/CRM: `form` + `received` | A persisted enquiry. |
| Confirmed appointment | Booking system: `booking` + `completed` | A booking, not a payment. |
| Answered call | Call provider: `call` + `completed` | An answered call; qualification is separate. |
| Collected payment | Payment authority: `payment` + `completed` | Known collected value in integer minor units. |

Use [examples/form.json](../examples/form.json) as a standalone saved-enquiry payload. Replace its synthetic IDs/times and null reference with verified source data; add the hosted wrapper from [CRM integration guide](crm.md) when using PipelineOn. Keep synthetic outcomes in a separate QA database.

A thank-you page reload must not create another payment. Use the source transaction/submission ID on the server. A pixel visit ID and a business outcome's `externalId` are different identifiers.

## Install the self-hosted pixel

Configure the exact website origins in `KIT_ALLOWED_ORIGINS`, including `www` when used. `KIT_PUBLIC_URL` is the kit's HTTPS origin. Install once per page, including landing pages and every form step:

```html
<script defer src="https://attribution.example.com/pixel.js" data-site="your-website"></script>
<form data-attribution-site="your-website" action="/enquiries" method="post">
  <!-- Keep your existing form fields and handler. -->
  <button type="submit">Request a quote</button>
</form>
```

Keep this a classic script: do not add `type="module"` or `crossorigin`. Cross-origin script requests carrying an Origin header are not served by the kit's private-route CORS policy.

Replace the host and site ID. The form attribute opts into a hidden `visitorSessionId` at native submission. It does not save the enquiry or create an outcome.

Collection and storage start disabled. Once the script is loaded, connect the consent manager to:

```js
const tracker = window.OpenAttribution?.sites['your-website'];
tracker?.consent(true); // Only after permission from your consent manager.
// On withdrawal: tracker?.consent(false).
```

If you inject the script only after consent, `data-consent="granted"` enables it on load. Optional chaining avoids an error but does not retry a consent call made before the script loads: wire both script readiness and consent changes into your existing consent manager. Global Privacy Control disables collection.

SPA path/query navigation and common `#/` or `#!/` hash routes are observed automatically through `pushState`, `replaceState`, native hash changes and back/forward navigation. Keep one installed script; remove older router callbacks that also call `tracker.track()` for those navigations to avoid counting twice. State-only updates, ordinary section anchors and authentication fragments do not create pageviews. Route paths and campaign queries are sanitized before collection and storage; hash route campaign parameters are available to attribution reporting, with outer query values taking precedence within the same URL.

Rapid changes are queued with their original sanitized URLs and internal referrers. Consent withdrawal clears queued routes and removes this site's navigation observer. A long-lived app can produce more pageviews without creating a new browser document; hosted page-load timing diagnostics remain document-level measurements.

## Use the correct PipelineOn interface

Copy the actual website snippet from **Settings > Tracking** in PipelineOn, including its public tag and collector URL. Do not substitute the kit snippet, an invented tag or a private API key. Use the hosted installation's consent controls with your consent manager.

```js
const context = window.PipelineOn?.getTrackingContext('YOUR_TRACKING_TAG');
const visitorSessionId = context?.visitorSessionId ?? null;
```

PipelineOn emits `pipelineon:session` with `{tag, visitorSessionId}`. The kit emits `open-attribution:session` with `{siteId, visitorSessionId}`. Filter by the intended tag/site. Readiness does not grant advertising consent. The kit's `data-attribution-site` form helper is not a hosted-pixel feature.

## Carry the reference into the enquiry

For a custom/AJAX form, read the reference inside the existing submission handler immediately before serialization:

```js
const context = window.OpenAttribution?.sites['your-website']?.getTrackingContext();
const visitorSessionId = context?.visitorSessionId ?? null;
// Add this to the existing request body sent to YOUR form backend.
```

Use the hosted getter instead on PipelineOn. For `FormData`, set `formData.set('visitorSessionId', visitorSessionId ?? '')` before sending. Some frameworks serialize before the native submit listener runs, so use their supported callback. Do not add a second handler that submits twice.

The backend saves the reference on the enquiry/job and carries it into related bookings/payments. Treat browser input as untrusted: a successful backend save determines whether an outcome happened. If the reference is absent or invalid, preserve the enquiry and leave attribution unlinked. Never delay or prevent a valid submission waiting for tracking.

Before calling the strict outcome API, convert an empty or invalid hidden field to `null` on your backend. The API rejects `visitorSessionId: ""`. For example, inside your existing server handler:

```js
const supplied = typeof form.visitorSessionId === 'string' ? form.visitorSessionId.trim() : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const visitorSessionId = uuid.test(supplied) ? supplied.toLowerCase() : null;
// Save the enquiry first; use this value in its normalized outcome.
```

A well-formed UUID is still untrusted. The service must resolve it within the intended website; do not use it as proof of identity or consent.

Cross-origin iframes require the form provider's supported hidden fields/callback or an origin-checked `postMessage` bridge. The parent script cannot read an unrelated iframe. Cross-domain visits do not automatically share localStorage identity. Never place private tokens in iframe URLs.

## Preserve source parameters

The pixel keeps permitted `utm_*` values, supported click IDs such as `gclid`, `fbclid`, `gbraid`, `wbraid`, and campaign/ad identifiers. Numeric ad IDs remain strings. Values over 512 characters, sensitive UTM names and unsafe values are rejected. Unknown query keys and fragments are removed.

```text
https://www.example.com/quote?utm_source=google&utm_medium=cpc&utm_campaign=setup-test&utm_content=variant-a&utm_term=roof-repair
```

Check that redirects preserve the tags and that the saved visit contains them. Do not tag internal navigation links: that can create false campaign touches. Do not put contact details or secrets into URLs. Literal ad-template placeholders remain literal until corrected upstream.

Google's documented bare ValueTrack fields `campaignid`, `adgroupid`, `keyword`, `device`, `matchtype`, `network` and `creative` are retained as well. IDs stay strings, including long creative IDs. The URL must actually contain these fields after Google's macro expansion and any redirects; the pixel cannot reconstruct a field that never reached the page. See [Google's tracking-template example](https://support.google.com/google-ads/answer/10070427?hl=en) and [ValueTrack definitions](https://support.google.com/google-ads/answer/6305348?hl=en).

`keyword` (or `utm_term={keyword}`) is the matched advertising keyword, not necessarily the person's search query. Google documents blank `{keyword}` values for keywordless AI Max, Dynamic Search Ads and Performance Max. Keep those blanks unavailable. Campaign IDs require an authorized Google Ads lookup or a supplied mapping to show campaign names; a generic Google referrer does not establish a paid campaign. Search-term reporting has separate privacy and availability limits.

First touch is the earliest observed entry before an outcome; last touch includes direct returns; last non-direct excludes direct touches. Internal navigation retains entry source. A changed campaign or 30-minute inactivity gap can create a new touch. These are observed browser histories, not guaranteed cross-device identity.

`getTrackingContext()` returns a session reference, not a UTM object. If the CRM needs acquisition fields, populate separate first/last fields through the server-side mapping. Do not append arbitrary UTM fields to the strict outcome API.

## Keep the website working

Allow the pixel host in the website's CSP `script-src` and collector origin in `connect-src`. Use the existing nonce/hash policy for inline bootstrap code. Allow exact origins, not a wildcard or disabled CSP. The collector must also allow the actual website origin.

Test denied/withdrawn consent, blocked storage, GPC, slow collection, early submission, SPA navigation, real mobile forms and embedded/multi-step forms. Storage failures can limit linking but must never block an enquiry. Follow [verification checklist](verify.md).
