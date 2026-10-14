# Verify the complete attribution setup

Run these checks for each website/source configuration. Use a dedicated QA website/database and recent synthetic records. Keep Meta disabled until attribution passes, then use a test destination/code. A synthetic production payment still counts in reports; a “test” label does not exclude it.

Record the deployed version, website/source account, test enquiry/job/payment IDs, occurrence times, accepted session, importer result and delivery ID. Record secret names only. Mark every stage `passed`, `failed`, `blocked` or `not tested`.

## Check source and revenue

| Check | Required evidence |
| --- | --- |
| Service/authentication | Correct version at kit `/health` or hosted `/api/health`. Missing credentials reject private requests; read credentials cannot write. |
| Tagged visit | After consent, visit `?utm_source=google&utm_medium=cpc&utm_campaign=setup-a`. The collector accepts it and the getter returns a reference. |
| Second touch | In the same browser, visit `?utm_source=facebook&utm_medium=paid_social&utm_campaign=setup-b` before the outcome. Both touches remain. |
| Form save | The real form saves an enquiry carrying the reference. Validation errors and failed saves do not produce successful outcomes. |
| Ingestion | An actual source/adapter test record has an import receipt and a stored outcome. |
| Revenue | A separate completed USD 1250.50 test payment is exactly `125050` / `USD`. Booking/estimate values are not counted as payments. |
| Attribution | First touch points to the first observed campaign; last touch to the second. Use a report interval containing the original outcome time. |
| Direct return | After a 30-minute inactivity gap, a direct return can become last touch while last non-direct retains the campaign. Do not change production clocks. |
| Replay | Repeat exact IDs/payload/revision. Kit returns `duplicate`; hosted retries reuse their `Idempotency-Key`. Counts/revenue do not increase. |
| Correction | A genuine newer revision updates one fact; older revisions cannot overwrite it; conflicting same-revision data fails. |
| Missing reference | A successful enquiry without a session stays saved and unlinked. No source is guessed. |
| Isolation | Another site's reference never creates a cross-client link. Credentials remain scoped. |
| Restart | Facts, queued work and receipts survive restart; replay is not a second payment. |

For the kit, query `/v1/report?from=<ISO>&to=<ISO>&model=first_touch`, then `last_touch` and `last_non_direct` with a read token. Ranges are start-inclusive/end-exclusive, at most 31 days. Inspect disclosed history limits. `/v1/export` provides stored outcome facts; page through all results when needed.

PipelineOn uses its own attribution UI/API and import receipts. Follow the wrapper/scopes in the [API reference](api.md#send-to-the-correct-api). Do not assume its response shape is the kit's.

## Check Meta delivery

1. Inventory existing senders and choose one owner per logical conversion. Keep other senders' events on `deliveryOwner: "external"` unless intentionally transferring ownership.
2. Configure the intended test dataset/code. Supply an eligible recent synthetic outcome, explicit advertising consent and permitted matching data. Website events require the actual page URL and browser user agent.
3. Add the documented `meta` envelope to a new test outcome. This requests a send; it is not a dry run. Use the intended test destination.
4. Inspect the durable delivery receipt and matching event in Events Manager Test Events. Record name, stable event ID and acknowledgement. A mocked response does not pass this check.
5. Replay without changing identity/time. Confirm no extra logical conversion. Browser/server pairs need the same dataset, mapped name and shared ID.
6. Test denied consent, external ownership, unsupported outcomes and missing matching data. Check their stopped/skipped reasons. Transient failures retain identity through bounded retries.

Meta acceptance is separate from person matching or ad attribution. Corrections/tombstones do not recall an already accepted event. Never redate old events to fit a delivery limit.

## Check CallRail when used

Use [callrail guide](callrail.md) with an approved account, website number pool and forwarding destination. Prove number swapping, both captured cookies on the real call API record, signed webhook, current-state refresh and linked call receipt. Qualify the call and inspect the separate Meta test receipt. Replay and correct qualification. Provider review or unavailable number pools leave this stage blocked even when synthetic tests pass.

## Check customer experience and recovery

On desktop/mobile test consent denial/withdrawal, GPC, blocked storage, slow collection, form validation errors, SPA routes and embedded/multi-step forms. Tracking must never block an enquiry, booking, call or payment. Preserve original analytics/form handlers and verify no duplicate pixel or submission handler was added.

Using test credentials/data, exercise revoked access, provider throttling and worker interruption. Failures must be visible and recover without duplicate facts. Do not manufacture production outages or replay customer payments for these tests.

## Campaign and full-period reporting

Visit a consented URL with `utm_source=google&utm_medium=ppc&gad_campaignid=123&hsa_cam=123`, record a form against its accepted session, and verify Google Ads / Campaign ID 123. Repeat with `hsa_cam=456`: the report must retain both named fields and show a conflict without selecting a campaign. A Google referrer without paid tags belongs in Google referral. Test first, last and last non-direct models independently; never combine IDs across different touches.

Import more than 1,000 unique forms and stage changes in a period. Verify complete totals and export counts, with stage changes separate from conversions. Missed calls, failed bookings and won stages must not create successful conversions or payment revenue. History limits must warn about visit evidence without truncating activity totals. Confirm reporting sends nothing to advertising destinations and does not alter billing or recovery permissions.

## Handoff

```text
Version and commit:
Destination and website:
CRM and adapter version:
Source mapping and business definitions:
Secret names and secure location:
Visit and saved enquiry receipt:
Linked outcome and exact revenue:
First and last touch results:
Replay/correction/restart/isolation results:
Meta test receipt and Test Events evidence:
CallRail real-call evidence or blocker:
Desktop/mobile and existing form checks:
Backup, rollback and alert owner:
Failed, blocked or untested checks:
```

Keep the receipts and monitor queue age, unlinked outcomes and permanent failures. An earlier successful stage does not turn a later blocked stage into a pass.

## Google Ads destination

Follow [Google Ads setup](google-ads.md). Check account and distinct action IDs, original event time, permitted matching data and both consent choices. Validation is not a live conversion; a submitted request is not completed processing. Follow the same request through `SUCCESS` or review, then check account matching diagnostics separately. Do not replay validated history merely to switch to live.
