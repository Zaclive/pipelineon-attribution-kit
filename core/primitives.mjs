export class KitError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "KitError";
    this.code = code;
    this.status = status;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KitError("INVALID_INPUT", `${label} must be an object.`, 400);
  return value;
}
export function textValue(value, label, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    throw new KitError("INVALID_INPUT", `${label} must be a nonempty string of at most ${max} characters.`, 400);
  return value.trim();
}
export function timestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new KitError("INVALID_INPUT", `${label} needs an ISO timestamp with timezone.`, 400);
  const calendar = value.slice(0, 19);
  if (new Date(calendar + "Z").toISOString().slice(0, 19) !== calendar)
    throw new KitError("INVALID_INPUT", `${label} needs a valid calendar date and time.`, 400);
  return new Date(value).toISOString();
}
export function sessionReference(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new KitError("INVALID_INPUT", "Invalid visitorSessionId.", 400);
  return value.toLowerCase();
}
