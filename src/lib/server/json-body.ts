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

/**
 * The parsed JSON body, or null when it isn't JSON or runs past `maxChars`. Routes that hand their body to a model
 * call cap it here: a well-formed but enormous body would otherwise be paid for in full, and these routes are open
 * to guests.
 */
export async function readJsonBody(request: Request, maxChars: number): Promise<unknown> {
  try {
    const text = await request.text();
    return text.length > maxChars ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
