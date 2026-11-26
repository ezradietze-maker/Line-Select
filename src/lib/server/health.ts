import { sql } from "drizzle-orm";
import { getJson, setJson } from "@/lib/server/kv";
import { db } from "@/lib/server/postgres";

/**
 * What an outside uptime monitor checks every few minutes (`/api/health`), so the owner hears the site is down from
 * the monitor, not from a pilot: the server answering, Redis (spend caps, rate limits, the alerts' own counters) and
 * Postgres (accounts, profiles). Redis is asked on every check; it costs one command. Postgres at most once an hour while
 * it's fine, and every five minutes once it isn't: Neon sleeps after five idle minutes and bills the time it's awake, and
 * a query every check would keep it up all day for nothing. The last answer is kept in Redis, so however many monitors
 * (or strangers) ask, the database is asked no more often.
 */

export const DB_RECHECK_OK_SECONDS = 60 * 60;
export const DB_RECHECK_DOWN_SECONDS = 5 * 60;
/** Each store gets this long to answer: a monitor waits about 30 seconds before it calls the site down. */
export const CHECK_TIMEOUT_MS = 8_000;
const DB_KEY = "line-select:health:database";

type Part = "ok" | "down";
export interface Health {
  ok: boolean;
  redis: Part;
  database: Part;
  /** When the database was last asked; its answer stands until the next ask. */
  databaseCheckedAt: string | null;
}

interface DbCheck {
  ok: boolean;
  at: string;
}

function within<T>(work: Promise<T>, ms = CHECK_TIMEOUT_MS): Promise<T> {
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))]);
}

/** Kept here too when Redis is down: then the database isn't asked more than once an hour by each server either. */
let lastDbCheck: DbCheck | null = null;

async function askDatabase(now: Date): Promise<DbCheck> {
  try {
    await within(db.execute(sql`select 1`));
    return { ok: true, at: now.toISOString() };
  } catch (e) {
    console.error("[health] database didn't answer", e instanceof Error ? e.message : e);
    return { ok: false, at: now.toISOString() };
  }
}

const due = (c: DbCheck | null, now: Date) =>
  !c || now.getTime() - Date.parse(c.at) >= (c.ok ? DB_RECHECK_OK_SECONDS : DB_RECHECK_DOWN_SECONDS) * 1000;

export async function checkHealth(now = new Date()): Promise<Health> {
  let redis: Part = "ok";
  let kept: DbCheck | null = null;
  try {
    kept = await within(getJson<DbCheck>(DB_KEY));
  } catch (e) {
    console.error("[health] redis didn't answer", e instanceof Error ? e.message : e);
    redis = "down";
    kept = lastDbCheck;
  }
  let check = kept;
  if (due(check, now)) {
    check = await askDatabase(now);
    if (redis === "ok") await within(setJson(DB_KEY, check, { ttlSeconds: 2 * DB_RECHECK_OK_SECONDS })).catch(() => {});
  }
  lastDbCheck = check;
  const database: Part = check?.ok ? "ok" : "down";
  return { ok: redis === "ok" && database === "ok", redis, database, databaseCheckedAt: check?.at ?? null };
}
