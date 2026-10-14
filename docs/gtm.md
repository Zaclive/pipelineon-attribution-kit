# Install the pixel through Google Tag Manager

Use a **web container** to install the browser pixel. You still need PipelineOn or a running kit server. A server-side GTM container is a separate product and is not required by this recipe.

Choose either your existing direct installation or GTM for each website. First remove/disable the duplicate installation in your test workspace; do not publish until the consent and form checks below pass.

## Connect the consent manager

Your consent manager must report the current permission on page load and whenever it changes, including withdrawal. Map your approved attribution category to a real boolean. This is a custom bridge you implement; the kit does not automatically read Google's consent state.

After that category's state is known, the consent-manager callback pushes:

```js
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'po_attribution_consent',
  po_attribution_allowed: false
});
```

Use `true` only when that visitor has granted the required permission. Keep `false` for denied/unknown states. Do not paste an unconditional `true` into an All Pages tag. Google documents [consent initialization and tag checks](https://support.google.com/tagmanager/answer/10718549); use Consent Initialization for the consent manager, not for this tracking tag.

## Create the kit tag

1. In GTM, create a Data Layer Variable named **DLV - po_attribution_allowed**, using data-layer key `po_attribution_allowed`, version 2 and default `false`.
2. Create a Custom Event trigger for the exact name `po_attribution_consent`.
3. Create a Custom HTML tag named **Open Attribution consent bridge**. Paste [examples/gtm-kit-tag.html](../examples/gtm-kit-tag.html), replacing `your-website` and `https://attribution.example.com` with your configuration. Leave the GTM variable reference intact.
4. Use the custom event trigger and **Once per event** firing. The bridge handles both grant and withdrawal. Do not configure a tag-level check that prevents the withdrawal event from executing. Its consent decision comes from the CMP boolean; it does not collect on denial.
5. Configure CSP to permit that script/collector origin. Use your site's existing nonce policy if Custom HTML insertion is restricted. Never relax the whole policy to make a tag run.

The example waits for permission before loading the external pixel. It applies the latest permission if consent changes during loading, avoids a second script for the same site, and calls `consent(false)` on withdrawal. Global Privacy Control keeps it disabled. A failed script load can be retried on a later consent event or page load.

Google's [Custom HTML guide](https://support.google.com/tagmanager/answer/6107167) and [custom-event guide](https://support.google.com/tagmanager/answer/7679219) describe the container controls. A permission event is not a lead conversion.

## Carry the session through the form

Keep the form changes from [pixel guide](pixel.md#carry-the-reference-into-the-enquiry). GTM installation alone does not write a custom CRM field. A Custom JavaScript variable can read the current kit reference when needed:

```js
function () {
  var sites = window.OpenAttribution && window.OpenAttribution.sites;
  var tracker = sites && sites['your-website'];
  var context = tracker && tracker.getTrackingContext();
  return context ? context.visitorSessionId : '';
}
```

Read it inside the form's supported pre-serialization callback, or use the kit's native form attribute. Preserve the enquiry when it is empty. A generic GTM Form Submission or button-click trigger does not prove that the server saved anything; confirmed outcomes still come from the backend/CRM.

For an SPA, run `window.OpenAttribution.sites['your-website'].track()` after a successful route change once the tracker exists. Coordinate with existing navigation hooks so the same route change is not counted twice.

## PipelineOn hosted installation

Copy the website's exact snippet from PipelineOn Settings > Tracking into a Custom HTML tag and use its documented consent controls. The kit bridge file above only works with the kit. Keep the public tag/collector URL from the hosted snippet and retain its consent-revocation callback; do not paste private API credentials into GTM.

Use the [hosted session getter](pixel.md#use-the-correct-pipelineon-interface) in the actual form handler. If the hosted snippet is already installed directly and integrated with your CMP, retain that working setup instead of also installing it in GTM.

## Preview before publishing

Open GTM Preview/Tag Assistant on a tagged test URL and check:

- Before consent, there is no kit collection request or kit visitor storage.
- Granting permission loads one script and produces an accepted session.
- Repeating the same consent event does not load another script or create another initial visit.
- Withdrawal clears the getter; route changes cannot resume collection. Repeat with withdrawal while the script is still loading.
- A later grant resumes correctly; GPC still suppresses collection.
- A real mobile and desktop form saves the same session reference, or succeeds without one when tracking is unavailable.

Publish the tested container version and retain its version number for rollback. Run [verification checklist](verify.md) to verify the saved enquiry, source, revenue and any advertising receipt.
