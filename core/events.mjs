import { KitError } from "./primitives.mjs";

// Business facts stay independent of any advertising platform's event names.
export const BUSINESS_EVENTS = Object.freeze([
  "lead_received", "lead_qualified", "appointment_booked", "estimate_sent", "job_won", "payment_received",
]);
export function businessEventName(outcome) {
  const inferred = outcome.eventType === "payment" && outcome.outcome === "completed" ? "payment_received"
    : outcome.eventType === "booking" && outcome.outcome === "completed" ? "appointment_booked"
      : (outcome.eventType === "form" && ["received", "completed"].includes(outcome.outcome) || outcome.eventType === "call" && outcome.outcome === "completed") && outcome.qualification === "qualified" ? "lead_qualified"
        : outcome.eventType === "form" && ["received", "completed"].includes(outcome.outcome) ? "lead_received"
          : outcome.eventType === "estimate" && outcome.outcome === "completed" ? "estimate_sent" : null;
  if (outcome.businessEvent == null) return inferred;
  if (!BUSINESS_EVENTS.includes(outcome.businessEvent)) throw new KitError("INVALID_BUSINESS_EVENT", "Unsupported businessEvent.", 400);
  const valid = outcome.businessEvent === "job_won"
    ? outcome.eventType === "stage_change" && outcome.outcome === "completed"
    : outcome.businessEvent === inferred;
  if (!valid) throw new KitError("INVALID_BUSINESS_EVENT", "businessEvent does not describe this source outcome.", 400);
  return outcome.businessEvent;
}
export function platformEventName(outcome, platform) {
  const name = businessEventName(outcome);
  if (platform === "meta") return ({ lead_received: "Lead", lead_qualified: "Lead", appointment_booked: "Schedule", payment_received: "Purchase" })[name] ?? null;
  if (platform === "google_ads") return name;
  throw new KitError("INVALID_DESTINATION", "Unsupported advertising destination.", 400);
}
