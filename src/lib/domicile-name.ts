import { airportCityName } from "@/lib/airport-city-names";

/**
 * The domicile by its city, where the pack is at hand. The words a pilot reads are written once, for every pack, as "the
 * domicile" — the pack's own word — and the ex-pilot just says "Memphis": this swaps the one for the other, so "Earliest
 * report at the domicile" reads "Earliest report in Memphis". Without a pack, or for an airport with no city on file, the
 * words stand.
 */
export function namedDomicile(text: string, base: string | null | undefined): string {
  const city = base ? airportCityName(base) : null;
  if (!city || !/domicile/i.test(text)) return text;
  return text
    .replace(/\b(?:at|in) the domicile(?: city)?\b/g, `in ${city}`)
    .replace(/\bAt the domicile(?: city)?\b/g, `In ${city}`)
    .replace(/\b[Tt]he domicile(?: city)?\b/g, city);
}
