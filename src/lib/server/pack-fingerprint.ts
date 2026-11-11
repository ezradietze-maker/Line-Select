import { createHash } from "node:crypto";
import type { BidPack } from "@/types/bidpack";

/**
 * A short name for what trades are worked out from in a pack: each line's trips, their dates, report times, legs and
 * credit, and the vacation schedule. Two pilots who uploaded the same pack get the same fingerprint, whichever device or
 * app version read it; a pack with a trip moved, retimed or re-credited (edited, or read wrongly) gets another, so it
 * can't be matched as if it were the group's. Kept with the pack on the account and with each holding confirmed on it.
 */
export function tradePackFingerprint(pack: BidPack): string {
  const facts = {
    month: pack.month,
    base: pack.base,
    aircraft: pack.aircraft,
    seat: pack.seat,
    start: pack.bidPeriodStart,
    days: pack.bidPeriodDays,
    lines: pack.lines.map((l) => [
      l.lineNumber,
      l.trips.map((t) => [
        t.id,
        t.startDayIndex,
        t.tafbHours,
        t.creditHours,
        t.schedule.map((d) => [d.reportTimeLocal, d.legs.map((g) => [g.depAirport, g.arrAirport, g.startMinutes, g.endMinutes])]),
      ]),
    ]),
    vacations: (pack.seniorityList ?? []).map((e) => [e.seniority, e.vacations ?? []]),
  };
  return createHash("sha256").update(JSON.stringify(facts)).digest("base64url").slice(0, 32);
}
