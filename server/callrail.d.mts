import type { Outcome } from "../core/index.mjs";
export interface CallrailConfig { accountId: string; companyId: string; cookieName: string; deliveryOwner: "self" | "external"; apiKey: string; signingKey: string }
export interface CallrailJob { id: string; callId: string; leaseToken: string; generation: number; connectionVersion: string }
export interface CallrailFailure { reason: string; retryable: boolean; retryAfterSeconds: number | null }
export interface CallrailRepository<T extends CallrailJob> {
  claim(now: string): Promise<T | null>;
  complete(job: T, outcome: Outcome, now: string): Promise<unknown>;
  fail(job: T, failure: CallrailFailure, now: string): Promise<unknown>;
}
export function callrailHash(value: string | Uint8Array): string;
export function validateCallrailConfig(raw: unknown): CallrailConfig;
export function verifyCallrailWebhook(rawBody: Buffer, signature: string | null, signingKey: string, companyId: string): { callId: string; digest: string };
export function checkCallrailCompany(config: CallrailConfig, fetcher: typeof fetch): Promise<true>;
export function fetchCallrailCall(config: CallrailConfig, callId: string, fetcher: typeof fetch): Promise<Record<string, unknown>>;
export function mapCallrailCall(raw: unknown, config: CallrailConfig, now: string): Outcome;
export function processCallrailQueue<T extends CallrailJob>(repository: CallrailRepository<T>, options: { limit: number; now: () => string; config: (job: T) => Promise<CallrailConfig>; fetcher: typeof fetch }): Promise<{ processed: number }>;
