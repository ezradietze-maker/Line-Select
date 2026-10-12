import { parseAirportCode } from "@/lib/interview-story";
import type { BidPack } from "@/types/bidpack";

/** Who the pilot is, in a line, for every brain call: seat, base, the pack, and how they get to work. */
export function pilotContextFor(bidPack: Pick<BidPack, "aircraft" | "seat" | "base" | "month" | "lines">, who: { isCommuter: boolean | null; commuteFrom?: string | null; hasCrashPad: boolean | null }): string {
  const seat = bidPack.seat === "CAP" ? "captain" : bidPack.seat === "FO" ? "first officer" : bidPack.seat;
  const home = parseAirportCode(who.commuteFrom ?? "");
  const commute =
    who.isCommuter === true
      ? `Commutes to base${home ? ` from ${home}` : ""}${who.hasCrashPad === false ? ", no crash pad" : who.hasCrashPad ? ", has a crash pad" : ""}.`
      : who.isCommuter === false
        ? "Lives in base."
        : "Commute not stated.";
  return `${bidPack.aircraft} ${seat} based in ${bidPack.base} (${bidPack.month} bid pack, ${bidPack.lines.length} lines). ${commute} FedEx lets pilots deviate from a scheduled deadhead and ride a different airline flight on their own to the same city.`;
}
