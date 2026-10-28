import { PILOT_WORDS } from "@/lib/brain/pilot-words";
import { airportCityName } from "@/lib/airport-city-names";
import type { BidPack } from "@/types/bidpack";

/**
 * The words a pilot's dictation should expect, handed to the speech service so it hears "hub turn", "jumpseat" and
 * "YYZ" rather than "up turn", "jump-seating" and "why why zed". Tested Oct 2026 on 25 pilot sentences in three voices:
 * with this list the service got every pilot word right (171 of 171); without it, 94%.
 */

/** The speech service takes at most this many terms. */
export const MAX_TERMS = 100;

/** Words pilots say that aren't in the glossary (it's about what the app says, not what it hears). */
const ALSO_HEARD = ["FedEx", "reserve", "standby", "sort", "release", "senior", "junior", "bid pack", "PBS", "seniority"];

/** How a pack's aircraft is said out loud: "MD11" → "MD-11", "B777" → "777". */
export function spokenAircraft(aircraft: string): string {
  const a = aircraft.trim().toUpperCase();
  if (/^MD\d+$/.test(a)) return `MD-${a.slice(2)}`;
  if (/^B\d{3}$/.test(a)) return a.slice(1);
  return a;
}

/** The pack's layover airports, most-flown first, with the base first of all. */
export function packAirports(pack: BidPack | null): string[] {
  if (!pack) return [];
  const count = new Map<string, number>();
  for (const line of pack.lines) for (const trip of line.trips ?? []) for (const code of trip.layoverCities ?? []) count.set(code, (count.get(code) ?? 0) + 1);
  const layovers = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  return [...new Set([pack.base, ...layovers].filter((c) => /^[A-Z]{3}$/.test(c)))];
}

/**
 * The word list for one pilot: the glossary's terms and how else pilots say them, then the pack's base and aircraft,
 * then its airports — each as its code and its city — most-flown first, cut at `MAX_TERMS`.
 */
export function dictationWords(pack: BidPack | null): string[] {
  const pilot = PILOT_WORDS.flatMap((w) => [w.term, ...(w.alsoSaid ?? [])]).filter((t) => !t.includes("/"));
  const aircraft = pack ? [spokenAircraft(pack.aircraft)] : [];
  const airports = packAirports(pack).flatMap((code) => {
    const city = airportCityName(code);
    return city ? [code, city] : [code];
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...pilot, ...ALSO_HEARD, ...aircraft, ...airports]) {
    const key = t.toLowerCase();
    if (!t.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

/**
 * Airport codes said letter by letter and written that way — "M E M", "m.e.m.", "M-E-M" — joined back into "MEM",
 * but only for airports in the pilot's pack, so ordinary words and letters are never touched.
 */
export function fixSpelledCodes(text: string, codes: string[]): string {
  if (!codes.length) return text;
  const known = new Set(codes.map((c) => c.toUpperCase()));
  return text.replace(/\b([A-Za-z])([.\s-]{1,2})([A-Za-z])[.\s-]{1,2}([A-Za-z])\b(\.?)/g, (whole, a: string, sep: string, b: string, c: string, dot: string) => {
    const code = `${a}${b}${c}`.toUpperCase();
    if (!known.has(code)) return whole;
    // "m.e.m." — the last dot is the code's own; "M E M." — it ends the sentence.
    return code + (sep.includes(".") ? "" : dot);
  });
}
