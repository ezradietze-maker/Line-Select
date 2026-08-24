import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * A tiny persistent JSON store behind one interface, backed by Upstash
 * Redis when configured and a local file otherwise. Most production hosts
 * (Vercel included) don't give a Next.js app a writable, persistent
 * filesystem — a serverless function's disk is ephemeral and isn't shared
 * across instances — so a real deployment needs UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN set. Locally, neither is required: `npm run dev`
 * keeps working against `.data/` on disk exactly as before, so hacking on
 * the app never needs a cloud account.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

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
