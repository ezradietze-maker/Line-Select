/**
 * A request body that parsed as JSON isn't necessarily an object: `null`, a
 * number, a string or an array are all valid JSON, and every route below
 * destructures its body — so a bare `null` used to crash them with a 500
 * instead of the 400 a malformed request deserves.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string no longer than `max` — the shape every text field in a request body should be checked against before it's trimmed, hashed or stored. */
export function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
