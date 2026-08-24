import { getJson, setJson } from "@/lib/server/kv";
import type { HotelResult } from "@/types/hotel";

/**
 * Google Places charges per request, and a specific hotel's rating barely
 * changes week to week, so results are cached (via `kv.ts` — Redis in
 * production, a local file in dev) instead of hitting the API every time a
 * pilot expands a line or opens the Hotel Ratings page. A month is a
 * generous-but-not-forever TTL for this, and roughly matches how long
 * Google's terms allow caching place data like reviews before it needs
 * refreshing. A "not found" result is cached too, at the same TTL, so a
 * typo'd or genuinely unlisted property doesn't get re-queried on every page
 * load.
 */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function cacheKey(code: string, hotelName: string): string {
  return `hotel:${code.trim().toUpperCase()}|${hotelName.trim().toUpperCase()}`;
}

/** Wrapped so a cached "not found" (`hotel: null`) is distinguishable from "never looked up" (nothing stored at this key) — both would otherwise collapse to the same bare `null` from `getJson`. */
interface CacheEntry {
  hotel: HotelResult | null;
}

/**
 * Returns undefined on a cache miss — never looked up, expired (Redis drops
 * the key on its own; the local-file fallback checks its own stored
 * expiry), or written by an older version of this route before a field like
 * `amenities` or `reviewSummary` existed (checked structurally rather than
 * versioned, so an old cached entry just looks like a miss and re-fetches
 * instead of crashing or serving a silently-incomplete result).
 * `reviewSummary` can be a legitimate `null` (no reviews found, or review
 * summarization wasn't configured yet at fetch time) — only the field's
 * absence, not its value, means "written by an older version," so a real
 * `null` doesn't force a needless re-fetch (and re-billed LLM call).
 */
export async function getCachedHotel(key: string): Promise<HotelResult | null | undefined> {
  const entry = await getJson<CacheEntry>(key);
  if (!entry) return undefined;
  if (entry.hotel && (!("amenities" in entry.hotel) || !("reviewSummary" in entry.hotel))) return undefined;
  return entry.hotel;
}

export async function setCachedHotel(key: string, hotel: HotelResult | null): Promise<void> {
  await setJson<CacheEntry>(key, { hotel }, { ttlSeconds: CACHE_TTL_SECONDS });
}
