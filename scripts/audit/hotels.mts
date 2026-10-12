/**
 * Audit of the hotel ratings shown with every layover: for each hotel the
 * bid packs assign (by city), the Google Places match the app cached for it
 * (`hotel:CITY|NAME`, nothing re-fetched — no cost) is checked for being the
 * same property — its name sharing the printed name's real words — and in
 * the right place — near the airport the layover is at.
 *
 * Usage: npx tsx scripts/audit/hotels.mts
 */
process.loadEnvFile(".env.local");
const { readdirSync, readFileSync } = await import("node:fs");
const { restoreBidPack } = await import("@/lib/bidpack-storage");
const { coordinatesForAirport } = await import("@/lib/airport-coordinates");
const { cacheKey, getCachedHotel } = await import("@/lib/server/hotel-cache");
const { isPlausibleMatch, pickBestMatch, readHotelName, kmFromAirport } = await import("@/lib/hotels/hotel-names");
const { airportSearchName, citySearchName } = await import("@/lib/hotels/airport-names");
/** --rematch: for each cached match the check rejects, run the app's two searches with the spelled-out name (no cache writes, no reviews). */
const rematch = process.argv.includes("--rematch");
/** --only=SLC,SJC: just these cities. */
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");

const FAR_KM = 50;
const STOP = new Set(["HOTEL", "THE", "AND", "INTERNATIONAL", "AIRPORT", "INN", "AT", "BY", "A", "OF", "RESORT"]);
const words = (s: string) =>
  s
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
const km = (a: [number, number], b: { latitude: number; longitude: number }) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// Every distinct hotel the packs assign, with how many layovers use it.
const hotels = new Map<string, { city: string; name: string; layovers: number }>();
for (const f of readdirSync(".cache/packs").filter((x) => x.endsWith(".json"))) {
  const pack = restoreBidPack(JSON.parse(readFileSync(`.cache/packs/${f}`, "utf8")));
  for (const line of pack.lines)
    for (const t of line.trips)
      for (const d of t.schedule) {
        const names = [d.layover?.hotelName, ...(d.layover?.variants ?? []).map((v) => v.hotelName)].filter((n): n is string => !!n);
        for (const name of new Set(names)) {
          const k = `${d.layover!.city}|${name}`;
          const e = hotels.get(k) ?? { city: d.layover!.city, name, layovers: 0 };
          e.layovers++;
          hotels.set(k, e);
        }
        for (const l of d.legs)
          if (l.dayRoomHotel) {
            const k = `${l.arrAirport}|${l.dayRoomHotel}`;
            const e = hotels.get(k) ?? { city: l.arrAirport, name: l.dayRoomHotel, layovers: 0 };
            e.layovers++;
            hotels.set(k, e);
          }
      }
}

const out: Record<string, string[]> = {
  "never looked up": [],
  "looked up, no match found": [],
  "not assigned yet (TBA) — no longer looked up": [],
  "rejected by the new check (will be looked up again)": [],
  "far from the airport, but the right hotel": [],
  "name shares no words": [],
  fine: [],
};

/** The route's own two searches, with the spelled-out name; the best plausible candidate, or none. */
async function searchAgain(city: string, printed: string): Promise<string> {
  const key = process.env.GOOGLE_PLACES_API_KEY!;
  const n = readHotelName(printed);
  const search = async (q: string) => {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 5 }),
    });
    return (
      (
        (await r.json()) as {
          places?: { displayName?: { text?: string }; rating?: number; formattedAddress?: string; location?: { latitude: number; longitude: number } }[];
        }
      ).places ?? []
    );
  };
  const all = [...(await search(`${n.search} hotel near ${airportSearchName(city)}`)), ...(await search(`${n.search} hotel, ${citySearchName(city)}`))];
  // The app's own choice among them.
  const best = pickBestMatch(
    city,
    printed,
    all.map((p) => ({ ...p, name: p.displayName?.text ?? "", formattedAddress: p.formattedAddress ?? null, location: p.location ?? null }))
  );
  return best
    ? `"${best.displayName?.text}", ${best.formattedAddress}, ${kmFromAirport(city, best.location)?.toFixed(0)} km, ★${best.rating ?? "—"}`
    : "no plausible match — no rating shown";
}
for (const { city, name, layovers } of [...hotels.values()].sort((a, b) => b.layovers - a.layovers)) {
  if (only && !only.includes(city)) continue;
  const cached = await getCachedHotel(cacheKey(city, name));
  const tag = `${city} ${name} (${layovers} layovers)`;
  if (cached === undefined) out["never looked up"].push(tag);
  else if (cached === null) out["looked up, no match found"].push(tag);
  else {
    const at = coordinatesForAirport(city);
    const dist = at && cached.location ? km(at, cached.location) : null;
    const shared = words(name).filter((w) => words(cached.name).includes(w));
    const desc = `${tag} → "${cached.name}", ${cached.formattedAddress ?? "?"}${dist !== null ? `, ${dist.toFixed(0)} km` : ""}, ★${cached.rating ?? "—"}`;
    if (!readHotelName(name).assigned) out["not assigned yet (TBA) — no longer looked up"].push(desc);
    else if (!isPlausibleMatch(city, name, cached)) {
      out["rejected by the new check (will be looked up again)"].push(desc);
      if (rematch) out["rejected by the new check (will be looked up again)"].push(`    → now: ${await searchAgain(city, name)}`);
    } else if (dist !== null && dist > FAR_KM) out["far from the airport, but the right hotel"].push(desc);
    else if (words(name).length && !shared.length) out["name shares no words"].push(desc);
    else out.fine.push(desc);
  }
}
console.log(`${hotels.size} distinct hotels across the packs`);
for (const [k, xs] of Object.entries(out)) console.log(`\n${k}: ${xs.length}${k === "fine" ? "" : `\n  ${xs.slice(0, 40).join("\n  ")}`}`);
