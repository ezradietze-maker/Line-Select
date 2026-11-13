import { flyLine, NO_ELECTIONS, type CarryInItem, type PhaseInElections } from "@/lib/phase-in";
import type { BidPack } from "@/types/bidpack";

/**
 * What the pilot's own pack says about the lines a question names, worked out on their device from data it already
 * holds, so the question box can answer "would line 2016 conflict with my carry-in?" without the pack leaving it.
 * Only lines the question names go to the server, as a few sentences of fact.
 */

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "DEC26" → "2026-12", the form a contract phase is compared with. Null when a pack's month reads some other way. */
export function bidMonthOfPack(month: string | undefined): string | null {
  const m = month?.toUpperCase().match(/^([A-Z]{3})(\d{2})$/);
  const at = m ? MONTHS.indexOf(m[1]) : -1;
  return m && at >= 0 ? `20${m[2]}-${String(at + 1).padStart(2, "0")}` : null;
}

/** The question box, opened with a question already in it, from anywhere a pilot might wonder what a bid question means. */
export function contractQuestionHref(topic: string): string {
  return `/contract?q=${encodeURIComponent(`What does the contract say about this bid question: ${topic}`.slice(0, 500))}`;
}

/** A number followed by one of these is a length or a count, not a line or trip: "120 hours", "100 CH", "3-day". */
const A_COUNT_FOLLOWS = String.raw`(?!\s*-?\s*(?:(?:days?|hours?|hrs?|nights?|legs?|minutes?|mins?|ch|credit|block)\b|%))`;
const LINES = new RegExp(String.raw`\blines?\s*#?\s*(\d{3,5}(?:\s*(?:,|and|or|&)\s*#?\s*\d{3,5})*)\b${A_COUNT_FOLLOWS}`, "gi");
const TRIPS = new RegExp(String.raw`\b(?:trips?|pairings?)\s*#?\s*(\d{1,5}(?:\s*(?:,|and|or|&)\s*#?\s*\d{1,5})*)\b${A_COUNT_FOLLOWS}`, "gi");

/** "line 2016", "lines 2016 and 2024", but not "a line 120 hours long" or "lines 100 CH or more". */
export function linesNamed(question: string): string[] {
  const numbers = [...question.matchAll(LINES)].flatMap((m) => m[1].match(/\d{3,5}/g) ?? []);
  return [...new Set(numbers)];
}

/** "trip 301", "trips 301 and 302", "pairing #4410", but not "trips 3 days long": a count of days isn't a trip. */
export function tripsNamed(question: string): string[] {
  const numbers = [...question.matchAll(TRIPS)].flatMap((m) => m[1].match(/\d{1,5}/g) ?? []);
  return [...new Set(numbers)];
}

/**
 * The fact said of a line the question names that the pack doesn't have. The contract checker takes no number from
 * it: a number the pilot only asked about isn't backed by being missing ("Does line 1800 post at 1700?" would have
 * backed "it posts at 1800").
 */
export const lineNotInPack = (number: string) => `Line ${number} isn't in this pack.`;
export const LINE_NOT_IN_PACK = /\bLine \d+ isn't in this pack\./g;

export function packFacts(question: string, pack: BidPack | null, carryIn: CarryInItem[] = [], elections: PhaseInElections = NO_ELECTIONS): string | undefined {
  if (!pack) return undefined;
  const named = linesNamed(question);
  // Only the trips really in the pack are said: the contract checker lets a number through when these facts hold it,
  // so "Trip 3 isn't in this pack" would have backed the 3 of "trips 3 long".
  const inPack = new Set(pack.lines.flatMap((l) => l.trips.flatMap((t) => (t.pairingNumber ? [t.pairingNumber] : []))));
  const trips = tripsNamed(question).filter((n) => inPack.has(n));
  if (!named.length && !trips.length) return undefined;
  const facts = [`The pilot's bid pack: ${pack.month}, ${pack.base} ${pack.aircraft} ${pack.seat}, a ${pack.bidPeriodDays}-day bid period.`];
  for (const number of trips.slice(0, 4)) facts.push(`Trip ${number} is in this pack.`);
  for (const number of named.slice(0, 4)) {
    const line = pack.lines.find((l) => l.lineNumber === number);
    if (!line) {
      facts.push(lineNotInPack(number));
      continue;
    }
    const carries = line.carryOverCreditHours ? `, ${line.carryOverCreditHours} CH carrying into next bid period` : "";
    facts.push(`Line ${number} as printed: ${line.daysOff} days off, ${line.totalCreditHours} CH, ${line.totalTafbHours} hours TAFB, ${line.trips.length} trips${carries}.`);
    if (!carryIn.length) continue;
    const flown = flyLine(line, pack, carryIn, elections);
    if (flown.unchecked) {
      facts.push(`Line ${number}: its trips couldn't all be put on real dates, so its carry-in conflicts weren't checked.`);
      continue;
    }
    for (const d of flown.dropped) {
      const why = d.findings.map((f) => `${f.detail} (${f.section})`).join("; ");
      facts.push(`Line ${number} with the pilot's carry-in: trip ${d.trip.pairingNumber ?? "(no number)"} is dropped, ${d.makeUpCH} CH to make up. ${why}.`);
    }
    for (const f of flown.kept) {
      facts.push(`Line ${number} with the pilot's carry-in: ${f.waived ? "waived on the bid" : "unclear in the contract text, so left on the line"}: trip ${f.pairingNumber ?? "(no number)"}: ${f.detail} (${f.section}).`);
    }
    if (!flown.dropped.length && !flown.kept.length) facts.push(`Line ${number} with the pilot's carry-in: no conflict found.`);
    facts.push(`Line ${number} days off after carry-in: ${flown.daysOffAfter}.`);
  }
  if (named.length && !carryIn.length) facts.push("The pilot hasn't entered any carry-in for this pack, so conflicts with it can't be checked.");
  return facts.join("\n").slice(0, 2_000);
}
