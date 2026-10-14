# Bot filtering and ad-block diagnostics

The collector filters browser requests with an automation flag, a known crawler or automation user agent, or an empty user agent. Filtered requests return `status: "filtered"`, a `reason`, and `visitorSessionId: null`. They do not create a visit or a browser session. Replaying the same event ID does not add another check. A filtered browser request does not suppress a separately confirmed CRM outcome.

These checks are conservative indicators, not a guarantee that every bot is detected. A scripted browser can hide its automation flag. Missing plugins, languages, touch support or a short visit are not blockers. The kit does not trust caller-supplied Cloudflare bot-score headers. Your reverse proxy can add its own verified controls separately.

## Ad-block check

After tracking consent, the pixel briefly adds an offscreen ad-like element and a control element, reads their layout, then removes both. It makes no external probe requests and records no fingerprint.

| Result | Meaning |
| --- | --- |
| `detected` | The ad-like element was hidden while the control was visible. Site CSS can also cause this. |
| `not_detected` | Neither element was hidden at the time of the check. This does not establish that network requests are unblocked. |
| `unknown` | The page was not ready, both elements were hidden, or measurement was unavailable. |

Ad-block results never reject a visit or alter attribution, CRM outcomes, advertising delivery or exports. Consent withdrawal clears the local diagnostic. GPC prevents the check. A blocked pixel cannot report its own absence, so these counts describe received requests only and are not a recovery percentage.

## Inspect the result

On the website, after enabling tracking:

```js
window.OpenAttribution.sites["YOUR_SITE_ID"].getDiagnostics();
// { version: 1, webdriver: false, adBlockStatus: "detected" }
```

PipelineOn-hosted installs expose the same local check with:

```js
window.PipelineOn.getDiagnostics("YOUR_PUBLIC_TRACKING_TAG");
```

The kit dashboard shows counts for the selected report dates. `GET /v1/traffic-checks?from=ISO_TIME&to=ISO_TIME` returns accepted and filtered counts, filter reasons, and accepted visits by ad-block result. Authenticate using the dashboard session or a read token. Keep tokens off the website.

Only checks received after this version was installed are counted. Old visits remain intact and are not reported as clear. The database adds a separate checks table automatically on startup; back up the SQLite database before upgrading as usual. Reports and outcome exports keep their existing format.

## Test before launch

1. Grant consent on a tagged visit. Inspect its local diagnostic, collector response and server count.
2. Return without UTMs and submit a confirmed CRM outcome using the accepted session. Verify source and revenue in the report.
3. Enable a cosmetic ad blocker or temporarily hide `.adsbox` in your test page. Confirm `detected` while the visit and CRM outcome still work.
4. Hide both test elements or use a page without layout support. Confirm `unknown`, with tracking still working.
5. Use a test automation browser. Confirm the collector returns `filtered`, with no session reference. Confirm ordinary mobile browsers still collect.
6. Deny consent, enable GPC, and withdraw consent during collection. Confirm there are no new probes after denial and no stale accepted-session publication.
7. Retry the same event and compare reports and exports. Counts and revenue must not double.
