/**
 * A production startup check: the few environment variables without which the
 * site looks healthy but quietly stops protecting itself. It runs once from
 * the instrumentation `register` hook (`src/instrumentation.ts`), before the
 * server takes its first request, and throws loudly if any are missing so a
 * misconfigured deploy fails fast instead of serving a broken one.
 *
 * Why these two:
 *  - `DATABASE_URL` (or `POSTGRES_URL`) — without it every signed-in feature,
 *    draft and account is gone; `postgres.ts` would throw on first use anyway,
 *    but as a scattered 500 per route rather than at startup.
 *  - The Upstash Redis pair — `kv.ts` silently falls back to a per-instance
 *    file store when it's missing. On a serverless host (Vercel) each function
 *    instance then keeps its own counters on an ephemeral disk, so the spend
 *    caps (`spend-guard.ts`) and rate limits (`rate-limit.ts`) count almost
 *    nothing and stop capping spend — the one failure mode that costs real
 *    money without any visible error. Either naming works: Upstash-direct
 *    (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) or Vercel's KV
 *    integration (`KV_REST_API_URL` / `KV_REST_API_TOKEN`), matching `kv.ts`.
 *
 * Only the live site (Vercel's production environment) refuses to start. A
 * preview deploy or a local `next start` gets a warning, and development, tests
 * and the `next build` step (which runs with `NODE_ENV=production` but no live
 * credentials, e.g. in CI) are left alone, so nothing here can break a preview,
 * a local run, a test, or a build.
 */

export interface MissingEnv {
  /** What to set, as it reads in the dashboard — a slash means either name satisfies it. */
  name: string;
  /** What breaks without it, for the startup error. */
  why: string;
}

type EnvLike = Record<string, string | undefined>;

function isSet(env: EnvLike, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim() !== "";
}

/**
 * The required variables that are missing from `env`, or an empty list if all
 * are present. Pure — no reading of `NODE_ENV`, no throwing — so it's easy to
 * test and to reuse for a health check.
 */
export function missingProductionEnv(env: EnvLike = process.env): MissingEnv[] {
  const missing: MissingEnv[] = [];

  if (!isSet(env, "DATABASE_URL") && !isSet(env, "POSTGRES_URL")) {
    missing.push({
      name: "DATABASE_URL (or POSTGRES_URL)",
      why: "the Postgres connection — accounts, drafts and every signed-in feature need it",
    });
  }

  const hasRedisUrl = isSet(env, "UPSTASH_REDIS_REST_URL") || isSet(env, "KV_REST_API_URL");
  const hasRedisToken = isSet(env, "UPSTASH_REDIS_REST_TOKEN") || isSet(env, "KV_REST_API_TOKEN");
  if (!hasRedisUrl || !hasRedisToken) {
    missing.push({
      name: "UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN)",
      why: "Redis — without it spend caps and rate limits fall back to a per-instance file store and stop capping spend",
    });
  }

  return missing;
}

/** A server taking requests (not dev, not tests, not `next build`). */
function isRunningServer(env: EnvLike): boolean {
  if (env.NODE_ENV !== "production") return false;
  // `next build` runs with NODE_ENV=production but no live credentials; it isn't a server taking requests.
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return true;
}

/**
 * The live site: Vercel's production environment. A preview deploy (each branch and pull request gets one) or a
 * `next start` on a laptop may well run without the live database and Redis, and refusing to start there only stopped
 * previews from loading; it gets a warning instead.
 */
function isLiveSite(env: EnvLike): boolean {
  return isRunningServer(env) && env.VERCEL_ENV === "production";
}

/**
 * Throws if the live site is starting without the required environment. The message names each missing variable and
 * what it breaks, so the fix is clear from the crash alone. Any other running server (a preview, a local
 * `next start`) only warns; dev, tests and `next build` say nothing.
 */
export function assertProductionEnv(env: EnvLike = process.env, warn: (message: string) => void = console.warn): void {
  if (!isRunningServer(env)) return;
  const missing = missingProductionEnv(env);
  if (missing.length === 0) return;
  const lines = missing.map((m) => `  - ${m.name}: ${m.why}`).join("\n");
  if (!isLiveSite(env)) {
    warn(`Line Select is running without part of its production environment (fine for a preview or a local run):\n${lines}`);
    return;
  }
  throw new Error(
    "Line Select cannot start: required production environment is missing or misconfigured.\n" +
      lines +
      "\nSpend caps and rate limits silently become useless without these. " +
      "See docs/launch/spend-caps.md for where to set them.",
  );
}
