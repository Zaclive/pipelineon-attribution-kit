import type { Outcome, MetaDestination } from "../core/index.mjs";
export interface MetaSnapshot { datasetId: string; mode: MetaDestination["mode"]; testEventCode: string | null;
  eventId: string; eventName: string; fingerprint: string; identity: string;
  body: { data: Array<{ event_name: string; event_id: string; event_time: number; action_source: string; user_data: Record<string, string | string[]>; event_source_url?: string; custom_data?: { currency: string; value: number } }>; test_event_code?: string };
}
export interface MetaReceipt { accepted: boolean; retryable: boolean; reason: string; httpStatus: number | null;
  eventsReceived?: number; traceId?: string | null; errorCode?: number | null; errorSubcode?: number | null; retryAfterSeconds?: number | null; }
export interface MetaJob { id: string; leaseToken: string; siteId: string; outcome: Outcome; destination: MetaDestination;
  snapshot: MetaSnapshot | null; attempts: number; firstAttemptAt: string | null; }
export interface StartedMetaJob extends MetaJob { snapshot: MetaSnapshot; firstAttemptAt: string; accessToken: string; }
export interface MetaFinish { status: "accepted" | "retry" | "review" | "skipped" | "blocked" | "failed"; reason: string; nextAttemptAt: string | null; receipt: MetaReceipt | null; }
export interface MetaRepository { claim(now: string): Promise<MetaJob | null> | MetaJob | null;
  begin(job: MetaJob, snapshot: MetaSnapshot, now: string): Promise<StartedMetaJob | null> | StartedMetaJob | null;
  finish(job: MetaJob, result: MetaFinish, now: string): Promise<unknown> | unknown; }
export function buildMetaSnapshot(outcome: Outcome, siteId: string, destination: MetaDestination): MetaSnapshot;
export function sendMeta(snapshot: MetaSnapshot, accessToken: string, fetcher: typeof fetch): Promise<MetaReceipt>;
export function processMetaQueue(repository: MetaRepository, options: { limit: number; now: () => string; send: (snapshot: MetaSnapshot, token: string) => Promise<MetaReceipt> }): Promise<{ inspected: number; accepted: number; retry: number; stopped: number }>;
export function encryptMetaSecret(value: string, hexKey: string | undefined, context: string): string;
export function decryptMetaSecret(value: string, hexKey: string | undefined, context: string): string;
