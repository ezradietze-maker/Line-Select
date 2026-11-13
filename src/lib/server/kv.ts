import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * A tiny persistent JSON store behind one interface, backed by Upstash
 * Redis when configured and a local file otherwise. Most production hosts
 * (Vercel included) don't give a Next.js app a writable, persistent
 * filesystem — a serverless function's disk is ephemeral and isn't shared
 * across instances — so a real deployment needs a Redis connection.
 * Connecting Upstash through Vercel's own Storage/Marketplace tab names the
 * variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Vercel's legacy KV
 * naming, still used for Upstash integrations); connecting an Upstash
 * account directly names them `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` — both are checked so either path works.
 * Locally, neither is required: `npm run dev` keeps working against
 * `.data/` on disk exactly as before, so hacking on the app never needs a
 * cloud account.
 */
const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const DATA_DIR = path.join(process.cwd(), ".data");

function localPath(key: string): string {
  return path.join(DATA_DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

interface LocalEnvelope<T> {
  value: T;
  /** Only meaningful for the local-file fallback — Redis expires keys natively via `ex`. */
  expiresAt: number | null;
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (redis) {
    const value = await redis.get<T>(key);
    return value ?? null;
  }
  try {
    const file = localPath(key);
    if (!existsSync(file)) return null;
    const envelope = JSON.parse(readFileSync(file, "utf8")) as LocalEnvelope<T>;
    if (envelope.expiresAt !== null && Date.now() > envelope.expiresAt) return null;
    return envelope.value;
  } catch {
    return null;
  }
}

export async function setJson<T>(key: string, value: T, options?: { ttlSeconds?: number }): Promise<void> {
  if (redis) {
    if (options?.ttlSeconds) {
      await redis.set(key, value, { ex: options.ttlSeconds });
    } else {
      await redis.set(key, value);
    }
    return;
  }
  const file = localPath(key);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const envelope: LocalEnvelope<T> = {
    value,
    expiresAt: options?.ttlSeconds ? Date.now() + options.ttlSeconds * 1000 : null,
  };
  writeFileSync(file, JSON.stringify(envelope, null, 2), "utf8");
}

/**
 * Adds to a counter and makes sure it ends: INCRBY, then EXPIRE whenever the key has no end yet (TTL -1) — a key just
 * made, or one an older version left counting forever. One Lua script, so one HTTP request to Upstash: as two, an
 * EXPIRE lost after its INCR (a timeout, a frozen function) left a counter that never reset, and a login or rate
 * limit that never let go.
 */
const ADD_WITH_END = `local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return n`;

/**
 * Atomically increments a counter key by 1, creating it at 1 with the given
 * TTL the first time it's touched — used for rate limiting (see
 * `lib/rate-limit.ts`). Redis runs the script whole, which matters under
 * concurrent requests; the local-file fallback does a plain
 * read-modify-write, imprecise under true concurrency but fine for the
 * single-process dev server it's actually used on.
 */
export async function incrementCounter(key: string, ttlSeconds: number): Promise<number> {
  return addToCounter(key, 1, ttlSeconds);
}

/**
 * Takes a lock that lets itself go after `ttlSeconds` — whether this caller got it. One SET NX EX, so the lock and its
 * end are made together: an INCR whose EXPIRE call got lost left a lock that never ended.
 */
export async function takeLock(key: string, ttlSeconds: number): Promise<boolean> {
  if (redis) return (await redis.set(key, 1, { nx: true, ex: ttlSeconds })) === "OK";
  if ((await getJson<number>(key)) !== null) return false;
  await setJson(key, 1, { ttlSeconds });
  return true;
}

export async function deleteKey(key: string): Promise<void> {
  if (redis) {
    await redis.del(key);
    return;
  }
  try {
    const file = localPath(key);
    if (existsSync(file)) writeFileSync(file, JSON.stringify({ value: null, expiresAt: 0 }), "utf8");
  } catch {
    // Expires on its own.
  }
}

/** Like `incrementCounter`, by a whole `amount` at once (INCRBY) — the running total after adding it. */
export async function addToCounter(key: string, amount: number, ttlSeconds: number): Promise<number> {
  if (redis) {
    try {
      return Number(await redis.eval<[number, number], number>(ADD_WITH_END, [key], [amount, ttlSeconds]));
    } catch (e) {
      // Scripts refused (or the script itself wrong): counted the two-request way rather than every limit failing —
      // a lost EXPIRE is mended the next time the script runs.
      console.error("[kv] counter script failed; counting without it", e);
      const total = await redis.incrby(key, amount);
      if (total === amount) await redis.expire(key, ttlSeconds);
      return total;
    }
  }
  const next = ((await getJson<number>(key)) ?? 0) + amount;
  await setJson(key, next, { ttlSeconds });
  return next;
}

const TAKE_SLOT = `local n = redis.call('INCR', KEYS[1])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

// A key that already ran out isn't made again below zero, and an empty one is removed.
const RELEASE_SLOT = `if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local n = redis.call('DECR', KEYS[1])
if n <= 0 then redis.call('DEL', KEYS[1]) end
return n`;

/**
 * Takes one of `limit` places, for something that holds one while it runs (a paid call in flight) — whether this
 * caller got one. Each place taken pushes the key's end out to `ttlSeconds`, so it only runs out once nothing has
 * started for that long: a holder that crashed before `releaseSlot` can't keep its place past then. Refused tries
 * don't push it, or someone retrying hard would keep a stranded place forever. One script, so one round trip.
 */
export async function takeSlot(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
  if (redis) {
    try {
      return Number(await redis.eval<[number, number], number>(TAKE_SLOT, [key], [limit, ttlSeconds])) === 1;
    } catch (e) {
      // Places can't be counted: the call goes ahead, held by the spending hold that comes after this.
      console.error("[kv] place script failed; letting the call through", e);
      return true;
    }
  }
  const held = (await getJson<number>(key)) ?? 0;
  if (held >= limit) return false;
  await setJson(key, held + 1, { ttlSeconds });
  return true;
}

/** Gives back a place `takeSlot` gave. */
export async function releaseSlot(key: string): Promise<void> {
  if (redis) {
    await redis.eval<[], number>(RELEASE_SLOT, [key], []);
    return;
  }
  const held = await getJson<number>(key);
  if (held === null) return;
  if (held <= 1) await deleteKey(key);
  // The dev server's file store only: Redis keeps the key's own end.
  else await setJson(key, held - 1, { ttlSeconds: 10 * 60 });
}
