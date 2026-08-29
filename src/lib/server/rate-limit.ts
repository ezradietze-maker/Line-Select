import { getJson, setJson } from "@/lib/server/kv";

/**
 * A minimal failed-attempt counter for login, backed by the same persistent
 * kv store as everything else (`kv.ts`) — Redis in production, so this
 * actually holds up across serverless instances, not just a single warm
 * one. Scoped by both a `scope` (e.g. "login") and an `identifier` (e.g. a
 * normalized email) so different kinds of rate limits never collide.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 6;

interface AttemptRecord {
  count: number;
}

function rateLimitKey(scope: string, identifier: string): string {
  return `line-select:ratelimit:${scope}:${identifier}`;
}

/** True when this identifier has hit the failed-attempt ceiling within the current window. */
export async function isRateLimited(scope: string, identifier: string): Promise<boolean> {
  const record = await getJson<AttemptRecord>(rateLimitKey(scope, identifier));
  return (record?.count ?? 0) >= MAX_ATTEMPTS;
}

/** Records one failed attempt. The window resets from whenever the *first* failure in a burst landed — each call re-arms the same TTL, so a steady trickle of failures stays blocked rather than sliding the window forever. */
export async function recordFailedAttempt(scope: string, identifier: string): Promise<void> {
  const key = rateLimitKey(scope, identifier);
  const record = await getJson<AttemptRecord>(key);
  await setJson(key, { count: (record?.count ?? 0) + 1 }, { ttlSeconds: WINDOW_SECONDS });
}

/** Clears the counter after a genuine success, so a legitimate pilot who mistyped a password twice isn't penalized once they get it right. */
export async function clearAttempts(scope: string, identifier: string): Promise<void> {
  await setJson(rateLimitKey(scope, identifier), { count: 0 }, { ttlSeconds: WINDOW_SECONDS });
}
