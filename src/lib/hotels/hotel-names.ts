import { coordinatesForAirport } from "@/lib/airport-coordinates";

/**
 * Bid packs print crew hotels in a compressed house style — "DTREE S PARK",
 * "INTERCON DT", "MIS'N PALM HTL", "HOME2STES DOV", "HYAT REGENCY" — that a
 * map search doesn't understand: looked up as printed, several came back as
 * a different property (a Super 8 for "DTREE DTWN", a Montreal Hyatt for
 * Tulsa's "HYAT REGENCY"). Here the printed name is spelled out for the
 * search, and any match is checked for being the same hotel in the right
 * place before a pilot sees its rating.
 */

/** Whole phrases, read before single words. */
const PHRASES: [RegExp, string][] = [
  [/\bMIS'N PALM\b/g, "MISSION PALMS"],
  [/\bF\. ?AMERICANA\b/g, "FIESTA AMERICANA"],
  [/\bE STE T CORNER\b/g, "EMBASSY SUITES TYSONS CORNER"],
  [/\bS PARK\b/g, "SOUTHPARK"],
  [/\bCONV CTR\b/g, "CONVENTION CENTER"],
  [/\bCC PL\b/g, "COUNTRY CLUB PLAZA"],
  [/\bLK WASH\b/g, "LAKE WASHINGTON"],
  [/\bG'INN\b/g, "GARDEN INN"],
  [/\bCBM\b/g, "COURTYARD BY MARRIOTT"],
  // Marriott's Delta brand is listed as "Delta Hotels".
  [/\bDELTA (BY )?MARRIOTT\b/g, "DELTA HOTELS"],
];

/** Single abbreviated (or misspelled) words, as the packs print them. */
const WORDS: Record<string, string> = {
  DTREE: "DOUBLETREE",
  "D'TREE": "DOUBLETREE",
  DT: "DOWNTOWN",
  DTWN: "DOWNTOWN",
  DTOWN: "DOWNTOWN",
  "D/T": "DOWNTOWN",
  HGI: "HILTON GARDEN INN",
  GRDN: "GARDEN",
  INTERCON: "INTERCONTINENTAL",
  RI: "RESIDENCE INN",
  HOME2STES: "HOME2 SUITES",
  STES: "SUITES",
  STE: "SUITES",
  HTL: "HOTEL",
  PLZ: "PLAZA",
  PLZA: "PLAZA",
  PLM: "PALM",
  REN: "RENAISSANCE",
  SHEATON: "SHERATON",
  HYAT: "HYATT",
  MARRIOT: "MARRIOTT",
  "A/P": "AIRPORT",
  AP: "AIRPORT",
  "4PTS": "FOUR POINTS",
  CY: "COURTYARD",
  DPORT: "DAVENPORT",
  ANNPLS: "ANNAPOLIS",
  COLUMBA: "COLUMBIA",
  VANCVR: "VANCOUVER",
  CONFERNCE: "CONFERENCE",
  RCTR: "RIVERCENTER",
  KC: "KANSAS CITY",
  "E'VILLE": "EMERYVILLE",
  TWRS: "TOWERS",
  HBR: "HARBOR",
  GALLERI: "GALLERIA",
  INTL: "INTERNATIONAL",
  MDR: "MARINA DEL REY",
  CTR: "CENTER",
  INDY: "INDIANAPOLIS",
};

export interface HotelName {
  /** The name to search for and to compare matches against. */
  search: string;
  /** False when the pack hasn't assigned a hotel yet ("TBA") — nothing to look up. */
  assigned: boolean;
  /** The pack marks the hotel as projected rather than confirmed ("PROJECTED: HILTON"). */
  projected: boolean;
}

export function readHotelName(printed: string): HotelName {
  let s = printed.trim().toUpperCase();
  const projected = /^PROJECTED:\s*/.test(s);
  s = s
    .replace(/^PROJECTED:\s*/, "")
    // A phone number glued on ahead of the name ("915-351-2121/HILTON GRDN INN"), or a stray "+" after it.
    .replace(/^[\d\s\-()]{7,}\//, "")
    .replace(/\s*\+\s*$/, "")
    .trim();
  if (/^(TBA|TBD|TBN)$/.test(s)) return { search: s, assigned: false, projected };
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  s = s
    .split(/\s+/)
    .map((w) => WORDS[w] ?? w)
    .join(" ")
    // Anything after a slash left once "A/P" and "D/T" are read is printed debris ("…MARRIOTT/MORGAN STANLEY SMITH
    // BARNEY LLC", "HILTON SJC/TWRS").
    .replace(/\/.*$/, "")
    .trim();
  return { search: s, assigned: true, projected };
}

/** How the trip view shows a printed hotel name. */
export function displayHotelName(printed: string): string {
  const n = readHotelName(printed);
  if (!n.assigned) return "hotel to be announced";
  const name = printed
    .replace(/^PROJECTED:\s*/i, "")
    .replace(/\s*\+\s*$/, "")
    .trim();
  return n.projected ? `${name} (projected)` : name;
}

/** Words too generic to tell one property from another. */
const STOPWORDS = new Set(["HOTEL", "THE", "AND", "INTERNATIONAL", "AIRPORT", "INN", "AT", "BY", "A", "OF", "RESORT", "SUITES", "DOWNTOWN"]);

/** A name's real words, accents dropped ("Swissôtel" reads as SWISSOTEL) and plurals singular ("Aparthotels"). */
/** Brands whose name contains another's — a Hilton Garden Inn is not "the Hilton", a Holiday Inn Express not the Holiday Inn. */
const COMPOUND_BRANDS: [RegExp, string][] = [
  [/\bHILTON GARDEN INN\b/g, "HILTONGARDENINN"],
  [/\bHOLIDAY INN EXPRESS\b/g, "HOLIDAYINNEXPRESS"],
  [/\bHOLIDAY INN\b/g, "HOLIDAYINN"],
  [/\bHAMPTON INN\b/g, "HAMPTONINN"],
  [/\bRESIDENCE INN\b/g, "RESIDENCEINN"],
];

export function significantWords(name: string): string[] {
  let n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  for (const [re, to] of COMPOUND_BRANDS) n = n.replace(re, to);
  return n
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("S") ? w.slice(0, -1) : w));
}

/** The words of a printed name a match has to show — its brand and place words, not airport codes (which no listing prints). */
export function wantedWords(printed: string): string[] {
  return significantWords(withoutParentBrand(readHotelName(printed).search)).filter((w) => !(w.length === 3 && coordinatesForAirport(w)));
}

/** "DoubleTree by Hilton", "Courtyard by Marriott": the parent brand isn't the hotel — a printed "HILTON" is no DoubleTree. */
const SUB_BRAND =
  /\b(COURTYARD|FAIRFIELD|RESIDENCE INN|SPRINGHILL SUITES|TOWNEPLACE SUITES|ALOFT|ELEMENT|MOXY|AC HOTEL|DELTA HOTELS|DOUBLETREE|EMBASSY SUITES|HAMPTON INN|HOME2 SUITES|HOMEWOOD SUITES|TRU|SPARK|HYATT PLACE|HYATT HOUSE)( BY)? (HILTON|MARRIOTT|HYATT|WESTIN)\b/gi;
const withoutParentBrand = (name: string) =>
  name.replace(SUB_BRAND, "$1").replace(/\bby (Hilton|Marriott|Hyatt|IHG|Wyndham|Westin|Radisson|Accor|Choice Hotels)\b/gi, " ");

/**
 * How many of the printed name's words a candidate shows — in its own name, or in the city and region of its address
 * (Burlingame for the SFO DoubleTree), never its street (an airport Hyatt on "Rue de la Belle Étoile" is not the Hyatt
 * Étoile).
 */
export function matchedWords(printed: string, candidate: { name: string; address?: string | null }): number {
  const place = (candidate.address ?? "").split(",").slice(1).join(" ");
  const have = new Set([...significantWords(withoutParentBrand(candidate.name)), ...significantWords(place)]);
  return wantedWords(printed).filter((w) => have.has(w)).length;
}

/** Crew hotels sit near the airport or in the city it serves — sometimes the next one over (Liège crews in Cologne, Oakland's in Burlingame), never across the country. */
export const MAX_HOTEL_KM = 150;

function km(a: [number, number], b: { latitude: number; longitude: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Distance from the layover's airport, in km — null when either place is unknown. */
export function kmFromAirport(code: string, location: { latitude: number; longitude: number } | null | undefined): number | null {
  const at = coordinatesForAirport(code);
  return at && location ? km(at, location) : null;
}

/**
 * Whether a map match is the hotel the pack printed: within reach of the layover's airport, and its name or address
 * showing most of the printed name's real words — brand and place both, so the airport Hyatt Place doesn't stand in for
 * the Hyatt Regency Étoile, a Fiesta Inn for the Fiesta Americana, or a Montreal Hyatt for Tulsa's.
 */
export function isPlausibleMatch(
  code: string,
  printed: string,
  candidate: { name: string; formattedAddress?: string | null; location?: { latitude: number; longitude: number } | null }
): boolean {
  if (!readHotelName(printed).assigned) return false;
  const distance = kmFromAirport(code, candidate.location);
  if (distance !== null && distance > MAX_HOTEL_KM) return false;
  const wanted = wantedWords(printed).length;
  return wanted === 0 || matchedWords(printed, { name: candidate.name, address: candidate.formattedAddress }) * 2 > wanted;
}

/** The printed name asks for a downtown property ("DT", "DTWN") — of two equally good matches, the one away from the airport. */
export const wantsDowntown = (printed: string) => /\bDOWNTOWN\b/.test(readHotelName(printed).search);

/** Words in a candidate's name the printed name doesn't account for — fewer is closer ("Clark Marriott" over "The Lounge at Clark Marriott"). */
function extraWords(printed: string, name: string): number {
  const wanted = new Set(significantWords(withoutParentBrand(readHotelName(printed).search)));
  return significantWords(withoutParentBrand(name)).filter((w) => !wanted.has(w)).length;
}

/**
 * Of the map's candidates, the one that's this hotel: only plausible ones (see `isPlausibleMatch`); then the most of
 * the printed name's words, the fewest extra ones, and — of equals — the nearer to the airport, or for a printed
 * downtown hotel the one away from it. Null when none is plausibly this hotel.
 */
export function pickBestMatch<T extends { name: string; formattedAddress?: string | null; location?: { latitude: number; longitude: number } | null }>(
  code: string,
  printed: string,
  candidates: T[]
): T | null {
  const downtown = wantsDowntown(printed);
  let best: T | null = null;
  let bestRank = [-Infinity, -Infinity, -Infinity];
  for (const c of candidates) {
    if (!isPlausibleMatch(code, printed, c)) continue;
    const distance = kmFromAirport(code, c.location) ?? 0;
    const rank = [matchedWords(printed, { name: c.name, address: c.formattedAddress }), -extraWords(printed, c.name), downtown ? distance : -distance];
    const better = rank[0] !== bestRank[0] ? rank[0] > bestRank[0] : rank[1] !== bestRank[1] ? rank[1] > bestRank[1] : rank[2] > bestRank[2];
    if (better) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}
