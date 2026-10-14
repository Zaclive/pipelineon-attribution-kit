export function hashMatchingData(input: { email?: string; phone?: string }, platform: "meta" | "google_ads"): { emailSha256?: string; phoneSha256?: string };
