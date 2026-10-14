export function metaStatusLabel(status) {
  return ({ queued: "Queued", processing: "Sending", retry: "Retry scheduled", accepted: "Meta received", blocked: "Setup needed", skipped: "Not sent", failed: "Delivery failed", review: "Review needed" })[status] ?? "Unknown";
}
export function metaReasonMessage(reason) {
  return ({ awaiting_delivery: "Waiting for the worker and an enabled destination.", manual_retry: "A retry has been requested.", sending: "An attempt has started; confirmation is pending.", meta_received: "Meta acknowledged receiving this event. This does not confirm an ad match or attributed sale.",
    transport_uncertain: "The network result is uncertain. A retry keeps the same ID and payload.", unconfirmed_response: "Meta did not confirm receiving one event.", meta_rejected: "Meta rejected the request. Check its error code and your credentials.",
    worker_interrupted: "The worker stopped before recording a result. The event identity is retained.", event_identity_conflict: "Another outcome owns this event ID at this destination. Check the source mapping.",
    changed_after_attempt: "The source or destination changed after an attempt. Review the original receipt.", retry_window_expired: "The safe retry window ended. Check Meta before further action.", retry_budget_exhausted: "Automatic retries stopped. Creating a new ID could duplicate the conversion.",
    outcome_deleted: "The source outcome was deleted.", not_requested: "Advertising delivery was not requested.", external_sender: "Another integration owns delivery.", consent_denied: "Advertising measurement consent was not granted.",
    outcome_not_supported: "This activity is not an eligible form, qualified call, completed booking or payment.", time_missing: "The original activity time is missing.", event_in_future: "The activity time is in the future.", event_expired: "The original event is too old to send. Its time has not been changed.",
    website_context_missing: "Website events need the original page URL and browser user agent.", matching_data_missing: "Supply permitted customer-provided matching data.", payment_value_missing: "A payment needs a known amount and currency.", currency_unsupported: "This currency cannot be mapped safely.",
    invalid_conversion: "Correct the conversion fields in the source mapping.", credential_unavailable: "Check the server encryption key and saved destination token." })[reason] ?? "Inspect the source and delivery history.";
}
