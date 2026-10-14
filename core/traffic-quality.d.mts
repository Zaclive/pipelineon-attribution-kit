export type AdBlockStatus = "detected" | "not_detected" | "unknown";
export function adBlockStatus(value: unknown): AdBlockStatus;
export function browserBotReason(userAgent: string | null | undefined, webdriver: boolean | undefined, verifiedBot: boolean | null | undefined, botScore: number | null | undefined): string | null;
