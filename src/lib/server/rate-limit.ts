import { NextResponse } from "next/server";
import { DEVICE_COOKIE } from "@/lib/device-cookie";
import { incrementCounter, setJson } from "@/lib/server/kv";

/**
 * A minimal attempt counter for login, backed by the same persistent
 * kv store as everything else (`kv.ts`) — Redis in production, so this
 * actually holds up across serverless instances, not just a single warm
 * one. Scoped by both a `scope` (e.g. "login") and an `identifier` (e.g. a
 * normalized email) so different kinds of rate limits never collide.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 6;

// A plain integer under its own prefix: Redis INCR can't touch the `{ count }` objects the old read-then-write limiter left.
function attemptKey(scope: string, identifier: string): string {
  return `line-select:attempts:${scope}:${identifier}`;
}

/**
 * Takes one attempt before the password (or code) is checked; false once the ceiling is reached. Counting
 * first, atomically, is what stops a burst of parallel guesses: checking and then recording a failure let every
 * request in the burst see the same count. The window runs from the first attempt; a success clears it.
 */
export async function takeAttempt(scope: string, identifier: string): Promise<boolean> {
  return (await incrementCounter(attemptKey(scope, identifier), WINDOW_SECONDS)) <= MAX_ATTEMPTS;
}

/** Clears the counter after a genuine success, so a legitimate pilot who mistyped a password twice isn't penalized once they get it right. */
export async function clearAttempts(scope: string, identifier: string): Promise<void> {
  await setJson(attemptKey(scope, identifier), 0, { ttlSeconds: WINDOW_SECONDS });
}

/**
 * A second, simpler limiter for routes that don't have a per-account
 * success/failure to key off of (signup, PDF parsing, LLM/Places-backed
 * lookups) — a fixed-window request counter rather than the failed-attempt
 * tracking above. Fixed windows (not sliding/token bucket) are a deliberate
 * simplicity choice: good enough to stop scripted abuse and runaway API
 * cost without needing more precision than that. A burst right at a window
 * boundary can momentarily allow up to ~2x the stated limit — an accepted
 * trade for staying this simple.
 */
export async function checkRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean }> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `line-select:ratelimit:${bucket}:${identity}:${window}`;
  const count = await incrementCounter(key, windowSeconds);
  return { ok: count <= limit };
}

/** How many devices' worth of requests one address may make: a crew room or hotel shares one, and a device that drops its cookie lands here. */
export const ADDRESS_FACTOR = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The device id from the request's cookie, when it has a well-formed one. */
export function deviceIdFrom(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`));
  const id = match?.[1];
  return id && UUID.test(id) ? id : null;
}

/**
 * The limit for a route anyone can call, per device rather than per address: fifteen pilots on one crew room's
 * Wi-Fi each get the full `limit`, while the address as a whole gets `ADDRESS_FACTOR` times it, so clearing cookies
 * to look like a new device only reaches that ceiling. A request with no device cookie counts against its address
 * at the plain `limit`.
 */
export async function checkRequestLimit(bucket: string, request: Request, limit: number, windowSeconds: number): Promise<{ ok: boolean }> {
  const ip = clientIp(request);
  const device = deviceIdFrom(request);
  if (!device) return checkRateLimit(bucket, `ip:${ip}`, limit, windowSeconds);
  const [mine, address] = await Promise.all([
    checkRateLimit(bucket, `device:${device}`, limit, windowSeconds),
    checkRateLimit(`${bucket}:address`, ip, limit * ADDRESS_FACTOR, windowSeconds),
  ]);
  return { ok: mine.ok && address.ok };
}

/** Best-effort caller IP for rate-limiting anonymous routes — read from the headers most hosts (Vercel included) set on the incoming request. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429 }
  );
}
