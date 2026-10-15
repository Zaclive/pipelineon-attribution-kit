export interface BrowserSignature { version: 1; components: Partial<Record<"environment" | "screen" | "locale" | "capabilities" | "canvas" | "webgl", string>>; }
export interface ContinuityCandidate { visitorSessionId: string; lastSeenAt: string; score: number; maximumScore: number; matched: string[]; changed: string[]; unavailable: string[]; qualifies: boolean; }
export interface ContinuityEvidence { status: "possible_return" | "ambiguous" | "no_match" | "history_limited"; availableComponents: string[]; unavailableComponents: string[]; candidates: ContinuityCandidate[]; candidateCount?: number; inspected: number; reasons: string[]; }
export interface ContinuityObservation { visitorSessionId: string; evaluatedAt: string; lastSeenAt: string; evidence: ContinuityEvidence; }
export interface ContinuityReport { availability: "available" | "unavailable"; mode: "evaluation"; retentionDays: number; counts: Record<string,number>; observations: ContinuityObservation[]; limited: boolean; explanation: string; }
export const SIGNATURE_COMPONENTS: Readonly<Record<string,number>>;
export const CONTINUITY_DAYS: number;
export function normalizeBrowserSignature(input: unknown): BrowserSignature | null;
export function compareBrowserSignatures(current: unknown, previous: unknown): Omit<ContinuityCandidate, "visitorSessionId" | "lastSeenAt">;
export function evaluateBrowserContinuity(current: BrowserSignature, previous: Array<{ visitorSessionId: string; lastSeenAt: string; signature: BrowserSignature }>, limited: boolean): ContinuityEvidence;
export function continuityReport(observations: ContinuityObservation[], limited: boolean): ContinuityReport;
