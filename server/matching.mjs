import { createHash } from "node:crypto";
import { KitError } from "../core/primitives.mjs";

// Call only in a trusted backend with permissioned customer-provided data.
// Raw identifiers are transformed here and must not be logged or persisted.
export function hashMatchingData(input, platform) {
  if (!["meta", "google_ads"].includes(platform)) throw new KitError("INVALID_DESTINATION", "Unsupported matching platform.", 400);
  const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
  const result = {};
  if (input.email != null) {
    if (typeof input.email !== "string" || input.email.length > 320) throw new KitError("INVALID_MATCHING", "Supply a valid customer email.", 400);
    let email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new KitError("INVALID_MATCHING", "Supply a valid customer email.", 400);
    const [local, domain] = email.split("@");
    if (platform === "google_ads" && ["gmail.com", "googlemail.com"].includes(domain)) email = local.replace(/\./g, "").split("+")[0] + "@" + domain;
    result.emailSha256 = hash(email);
  }
  if (input.phone != null) {
    if (typeof input.phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(input.phone)) throw new KitError("INVALID_MATCHING", "Supply a phone number in E.164 format with country code; do not guess the country.", 400);
    result.phoneSha256 = hash(platform === "meta" ? input.phone.slice(1) : input.phone);
  }
  return result;
}
