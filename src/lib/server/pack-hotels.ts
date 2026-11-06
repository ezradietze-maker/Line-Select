import { cacheKey } from "@/lib/server/hotel-cache";
import { getJson, setJson } from "@/lib/server/kv";

/**
 * Which hotels real bid packs contain, so a guest's hotel lookup can't be a made-up name sent to run up Google
 * charges: every pack the server parses records its hotels here, and a guest may look up only those (a cached one is
 * always fine). Signed-in pilots aren't held to it. Kept by the same key as the hotel cache, for a season.
 */

const KEEP_SECONDS = 120 * 24 * 60 * 60;
const seenKey = (code: string, hotelName: string) => `line-select:pack-hotel:${cacheKey(code, hotelName)}`;

/** Every (airport, hotel) a parsed pack names: overnight layovers, their dated variants, and day rooms. */
export function hotelsInPack(pack: unknown): { code: string; hotelName: string }[] {
  const found = new Map<string, { code: string; hotelName: string }>();
  const add = (code: unknown, hotelName: unknown) => {
    if (typeof code !== "string" || typeof hotelName !== "string" || !code.trim() || !hotelName.trim()) return;
    found.set(cacheKey(code, hotelName), { code: code.trim().toUpperCase(), hotelName: hotelName.trim() });
  };
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (typeof value !== "object" || value === null) return;
    const o = value as Record<string, unknown>;
    if (typeof o.city === "string") {
      add(o.city, o.hotelName);
      if (Array.isArray(o.variants)) for (const v of o.variants) add(o.city, (v as Record<string, unknown>)?.hotelName);
    }
    if (typeof o.arrAirport === "string") add(o.arrAirport, o.dayRoomHotel);
    for (const child of Object.values(o)) if (typeof child === "object" && child !== null) walk(child);
  };
  walk(pack);
  return [...found.values()];
}

/** Records a parsed pack's hotels. Never throws: a pack that parsed is never failed for this. */
export async function rememberPackHotels(pack: unknown): Promise<void> {
  try {
    await Promise.all(hotelsInPack(pack).map((h) => setJson(seenKey(h.code, h.hotelName), 1, { ttlSeconds: KEEP_SECONDS })));
  } catch (e) {
    console.error("[pack-hotels] not recorded", e);
  }
}

export async function isPackHotel(code: string, hotelName: string): Promise<boolean> {
  return (await getJson<number>(seenKey(code, hotelName))) === 1;
}
