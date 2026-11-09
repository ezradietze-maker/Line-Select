import { airportCityName } from "@/lib/airport-city-names";
import { parseAirportCode } from "@/lib/interview-story";
import type { BidPack } from "@/types/bidpack";

/** Who the pilot is, in a line, for every brain call: seat, domicile, the pack, and how they get to work. */
export function pilotContextFor(bidPack: Pick<BidPack, "aircraft" | "seat" | "base" | "month" | "lines">, who: { isCommuter: boolean | null; commuteFrom?: string | null; hasCrashPad: boolean | null; minHomeHours?: number | null }): string {
  const seat = bidPack.seat === "CAP" ? "captain" : bidPack.seat === "FO" ? "first officer" : bidPack.seat;
  const home = parseAirportCode(who.commuteFrom ?? "");
  const city = airportCityName(bidPack.base) ?? bidPack.base;
  const commute =
    who.isCommuter === true
      ? `Commutes to ${city}${home ? ` from ${home}` : ""}${who.hasCrashPad === false ? ", no crash pad" : who.hasCrashPad ? ", has a crash pad" : ""}.${who.minHomeHours ? ` Goes home between trips only if there'd be at least ${who.minHomeHours} hours at home, door to door; otherwise stays in ${city} and counts the trips as one departure.` : ""}`
      : who.isCommuter === false
        ? `Lives in ${city}.`
        : "Commute not stated.";
  return `${bidPack.aircraft} ${seat} at the ${bidPack.base} domicile (${city}; ${bidPack.month} bid pack, ${bidPack.lines.length} lines). ${commute} FedEx lets pilots deviate from a scheduled deadhead and ride a different airline flight on their own to the same city.`;
}
