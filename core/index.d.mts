export class KitError extends Error { code: string; status: number; constructor(code: string, message: string, status: number); }
export type Model = "first_touch" | "last_touch" | "last_non_direct";
export const MODELS: Model[];
export interface Touch { url: string; referrer: string | null; occurredAt: string; visitorId: string | null; parameters: Record<string, string>; sourceLabel: string; }
export interface Touches { firstTouch: Touch | null; lastTouch: Touch | null; lastNonDirectTouch: Touch | null; historyLimited: boolean; }
export interface Outcome { externalId: string; source: string; eventType: string; occurredAt: string; sourceUpdatedAt: string; outcome: string; qualification: string; visitorSessionId: string | null; amountMinor: number | null; currency: string | null; deleted: boolean; contactIds: string[]; direction: string; label: string; meta?: MetaEnvelope; googleAds?: GoogleEnvelope; businessEvent?: BusinessEvent; }
export interface ReportRow { externalId: string; source: string; eventType: string; occurredAt: string | null; sourceUpdatedAt: string; outcome: string; qualification?: string; amountMinor?: number | null; currency?: string | null; deleted: boolean; attribution?: { status: string; evidence: string | null; touches: Touches | null }; }
export interface Range { from: string; to: string; model: Model; }
export interface Coverage { limited: boolean; inspected: number; limit: number; }
export interface Totals { outcomes: number; calls: number; missedCalls: number; forms: number; bookings: number; qualifiedOutcomes: number; payments: number; unknownValuePayments: number; revenueByCurrency: Record<string, number>; }
export interface Report extends Range { version: number; totals: Totals; linkedOutcomes: number; unlinkedOutcomes: number; partialHistories: number; statuses: Record<string, number>; evidenceCounts: Record<string, number>; medianHoursToPayment: number | null; paymentLagSampleSize: number; groups: Array<Totals & { source: string; campaign: string }>; coverage: Coverage; explanation: string; }
export interface Telemetry { lastPageviewAt: string | null; taggedPageviews: number; checkedAt: string; }
export interface Doctor { checks: Array<{ id: string; status: "pass" | "action" | "unknown"; title: string; detail: string; action: string }>; checkedAt: string; status: string; explanation: string; }
export function object(value: unknown, label: string): Record<string, unknown>;
export function textValue(value: unknown, label: string, max: number): string;
export function timestamp(value: unknown, label: string): string;
export function sessionReference(value: unknown): string | null;
export function validateOutcome(value: unknown): Outcome;
export function reportRange(value: unknown, now: string): Range;
export function normalizeCall(value: unknown): Outcome;
export function safePage(value: unknown): { url: string; origin: string; parameters: Record<string, string> } | null;
export function buildTouches(observations: Array<{ url: string; referrer: string | null; occurredAt: string; visitorId: string | null }>, cutoffAt: string): Touches;
export function buildReport(rows: ReportRow[], range: Range, coverage: Coverage): Report;
export function trackingDoctor(report: Report, telemetry: Telemetry): Doctor;
export function formatMoney(amount: number, currency: string): string;
export interface MetaEnvelope {
  version: 1; deliveryOwner: "self" | "external"; consent: "granted" | "denied"; dataProvenance: "customer_provided";
  deduplication: "server_only" | "shared_event_id"; eventId: string | null;
  actionSource: "website" | "phone_call" | "physical_store" | "chat" | "email" | "system_generated" | "other";
  eventSourceUrl: string | null; userData: { emailSha256?: string; phoneSha256?: string; externalIdSha256?: string; fbp?: string; fbc?: string; clientUserAgent?: string };
}
export interface MetaDestination { datasetId: string; mode: "disabled" | "test" | "live"; testEventCode: string | null; }
export const META_GRAPH_VERSION: string;
export function metaStatusLabel(status: string): string;
export function metaReasonMessage(reason: string): string;
export const META_MAX_AGE_MS: number;
export const META_RETRY_WINDOW_MS: number;
export const META_MAX_ATTEMPTS: number;
export function validateMeta(raw: unknown): MetaEnvelope;
export function validateMetaDestination(raw: unknown): MetaDestination;
export function metaEventName(outcome: Pick<Outcome, "eventType" | "outcome"> & { qualification?: string }): "Lead" | "Schedule" | "Purchase" | null;
export function metaEligibility(outcome: Outcome, now: string): string | null;
export function metaRetry(attempt: number, firstAttemptAt: string, eventTime: number, now: string, retryAfterSeconds: number | null | undefined): string | null;
export type BusinessEvent = "lead_received" | "lead_qualified" | "appointment_booked" | "estimate_sent" | "job_won" | "payment_received";
export const BUSINESS_EVENTS: readonly BusinessEvent[];
export function businessEventName(outcome: { eventType: string; outcome: string; qualification?: string; businessEvent?: BusinessEvent }): BusinessEvent | null;
export function platformEventName(outcome: Outcome, platform: "meta" | "google_ads"): string | null;
export function normalizeBusinessEvent(raw: unknown): Outcome;
export interface GoogleEnvelope { version: 1; deliveryOwner: "self" | "external"; dataProvenance: "customer_provided";
  consent: { adUserData: "granted" | "denied"; adPersonalization: "granted" | "denied" }; transactionId: string | null;
  eventSource: "WEB" | "APP" | "IN_STORE" | "PHONE" | "MESSAGE" | "OTHER"; adIdentifiers: { gclid?: string; gbraid?: string; wbraid?: string }; userData: { emailSha256?: string; phoneSha256?: string }; }
export interface GoogleDestination { accountId: string; loginAccountId: string | null; mode: "disabled" | "validate" | "live"; conversionActions: Partial<Record<BusinessEvent,string>>; }
export const GOOGLE_MAX_AGE_MS: number;
export const GOOGLE_MAX_ATTEMPTS: number;
export const GOOGLE_RETRY_WINDOW_MS: number;
export function validateGoogle(raw: unknown): GoogleEnvelope;
export function validateGoogleDestination(raw: unknown): GoogleDestination;
export function googleEligibility(outcome: Outcome, destination: GoogleDestination, now: string): string | null;
export function googleRetry(attempt: number, firstAttemptAt: string, eventTime: string, now: string, retryAfterSeconds: number | null | undefined): string | null;
