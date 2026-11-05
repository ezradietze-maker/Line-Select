import { NextResponse } from "next/server";
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
