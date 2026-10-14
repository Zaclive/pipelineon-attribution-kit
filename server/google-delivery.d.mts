import type { Outcome, GoogleDestination } from "../core/index.mjs";
export interface GoogleSnapshot { accountId: string; conversionActionId: string; transactionId: string; businessEvent: string; mode: "disabled" | "validate" | "live"; identity: string; fingerprint: string;
  body: { destinations: Array<{ operatingAccount: { accountType: string; accountId: string }; productDestinationId: string; loginAccount?: { accountType: string; accountId: string } }>;
    events: Array<Record<string, unknown>>; validateOnly: boolean; encoding?: string }; }
export interface GoogleReceipt { accepted: boolean; retryable?: boolean; reason: string; httpStatus?: number | null; submitted?: boolean; validated?: boolean; processing?: boolean;
  requestId?: string; processingStatus?: string; errorCode?: string | null; retryAfterSeconds?: number | null; errors?: Array<{ reason: string; count: string | null }>; warnings?: Array<{ reason: string; count: string | null }>; warningCount?: number; }
export interface GoogleJob { id: string; leaseToken: string; siteId: string; outcome: Outcome; destination: GoogleDestination; snapshot: GoogleSnapshot | null; attempts: number; polls: number; requestId: string | null; firstAttemptAt: string | null; }
export interface GoogleResult { status: string; reason: string; nextAttemptAt: string | null; receipt: GoogleReceipt | null; }
export interface GoogleRepository { claim(now: string): Promise<GoogleJob | null>; begin(job: GoogleJob, snapshot: GoogleSnapshot, now: string): Promise<GoogleJob | null>; finish(job: GoogleJob, result: GoogleResult, now: string): Promise<void>; }
export function buildGoogleSnapshot(outcome: Outcome, siteId: string, destination: GoogleDestination): GoogleSnapshot;
export function sendGoogle(snapshot: GoogleSnapshot, token: string, fetcher: typeof fetch): Promise<GoogleReceipt>;
export function readGoogleStatus(snapshot: GoogleSnapshot, requestId: string, token: string, fetcher: typeof fetch): Promise<GoogleReceipt>;
export function googleTokenProvider(credentials: { clientId: string; clientSecret: string; refreshToken: string }, fetcher: typeof fetch, clock: () => number): () => Promise<string>;
export function processGoogleQueue(repository: GoogleRepository, options: { limit: number; now: () => string; token: (job: GoogleJob) => Promise<string>; send: (snapshot: GoogleSnapshot, token: string) => Promise<GoogleReceipt>; poll: (snapshot: GoogleSnapshot, requestId: string, token: string) => Promise<GoogleReceipt> }): Promise<{ inspected: number; submitted: number; validated: number; accepted: number; retry: number; stopped: number }>;
