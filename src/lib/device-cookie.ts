import { createHmac, timingSafeEqual } from "node:crypto";

/** The cookie that tells one device from another behind a shared address — set by `src/proxy.ts`, read by `checkRequestLimit`. Kept apart so the proxy loads nothing else. */
export const DEVICE_COOKIE = "ls_device";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The server's key for signing device ids; none on a deployment without one, where ids go unsigned as they used to. */
function secret(): string | null {
  return process.env.DEVICE_COOKIE_SECRET || process.env.ADMIN_API_KEY || null;
}

function signatureOf(id: string, key: string): string {
  return createHmac("sha256", key).update(id).digest("hex").slice(0, 32);
}

/**
 * A device id as the cookie carries it: signed, so a script can't make one up for every request — made-up ids each got
 * a fresh per-device allowance, leaving only the per-address limits to hold.
 */
export function deviceCookieValue(id: string): string {
  const key = secret();
  return key ? `${id}.${signatureOf(id, key)}` : id;
}

/** The device id in a cookie's value, when it's well formed and (with a key configured) signed by this server. */
export function deviceIdOf(value: string | undefined | null): string | null {
  if (!value) return null;
  const key = secret();
  const [id, signature] = value.split(".");
  if (!id || !UUID.test(id)) return null;
  if (!key) return signature === undefined ? id : null;
  if (!signature) return null;
  const expected = Buffer.from(signatureOf(id, key));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}
