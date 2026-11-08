import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { getBidDeadline } from "@/lib/bid-deadline-storage";
import type { BidCalendarEvent, BidPack, Seat } from "@/types/bidpack";

/** What the close needs from a pack. */
export type CalendarPack = Pick<BidPack, "id" | "month" | "base" | "seat" | "bidCalendar">;

/**
 * When this seat's monthly bid closes, best source first:
 *  1. what the pilot set themselves (they may know of a change the pack doesn't show);
 *  2. the bid calendar the pack prints on its cover ("OCT26 Cap Bid Closes 1200 CT");
 *  3. the 2026 contract's rule, counted from the pack's own printed "Bid Opens" — only for bid periods from
 *     December 2026, when that rule takes effect (CBA 2026 25.C.4; Implementation LOA, Phase 2).
 * Nothing is ever guessed from `bidPeriodStart`: the contract fixes close times from publication, not from
 * when the schedule starts.
 */

export type BidCloseSource = "pilot" | "pack" | "contract";

export interface BidClose {
  iso: string;
  source: BidCloseSource;
}

const CENTRAL = "America/Chicago";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function seatWord(seat: Seat): RegExp {
  return seat === "CAP" ? /\bCap(?:tain)?\b/i : /\bF\s*\/\s*O\b/i;
}

/** An event's printed date and time as an instant: CT is Memphis time; LBT is the pack's base. */
export function eventInstant(event: BidCalendarEvent, base: string): string | null {
  if (!event.time) return null;
  const zone = event.zone === "LBT" ? (timezoneForAirport(base) ?? CENTRAL) : CENTRAL;
  const [h, m] = event.time.split(":").map(Number);
  const dt = DateTime.fromISO(event.date, { zone }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

function events(pack: CalendarPack, pattern: RegExp): BidCalendarEvent[] {
  return (pack.bidCalendar ?? []).filter((e) => pattern.test(e.text));
}

/** The close the pack prints for this pack's month and seat. */
export function printedBidClose(pack: CalendarPack): string | null {
  const ev = events(pack, new RegExp(`^${pack.month}\\b.*\\bBid\\s+Closes\\b`, "i")).find((e) => seatWord(pack.seat).test(e.text));
  return ev ? eventInstant(ev, pack.base) : null;
}

/** "DEC26" → { year: 2026, month: 12 }. */
function monthOf(code: string): { year: number; month: number } | null {
  const m = code.match(/^([A-Z]{3})(\d{2})$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toUpperCase()) + 1;
  return month ? { year: 2000 + Number(m[2]), month } : null;
}

/** True from the December 2026 bid period on, when 25.C.4's new close times apply (Phase 2). */
export function newCloseRuleApplies(packMonth: string): boolean {
  const m = monthOf(packMonth);
  return !!m && (m.year > 2026 || (m.year === 2026 && m.month >= 12));
}

/**
 * CBA 2026 25.C.4: "Bidding for Captains shall close at 1200 CT on the 4th day following the publication of the
 * bid period package … Bidding for First Officers' bids shall close at 0700 CT on the 2nd day following the close
 * of the Captains' bid". Publication is the pack's own printed "<month> Bid Opens". The late-publication case
 * (72 hours after) isn't knowable from the pack, so the printed close always wins over this.
 */
export function contractBidClose(pack: CalendarPack): string | null {
  if (!newCloseRuleApplies(pack.month)) return null;
  const opens = events(pack, new RegExp(`^${pack.month}\\s+Bid\\s+Opens\\b`, "i"))[0];
  if (!opens) return null;
  const published = DateTime.fromISO(opens.date, { zone: CENTRAL });
  const captains = published.plus({ days: 4 }).set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  const close = pack.seat === "CAP" ? captains : captains.plus({ days: 2 }).set({ hour: 7, minute: 0 });
  return close.isValid ? close.toUTC().toISO() : null;
}

/** The close this pack's countdown should use, and where it came from. */
export function packBidClose(pack: CalendarPack): BidClose | null {
  const printed = printedBidClose(pack);
  if (printed) return { iso: printed, source: "pack" };
  const ruled = contractBidClose(pack);
  return ruled ? { iso: ruled, source: "contract" } : null;
}

export function effectiveBidClose(pack: CalendarPack): BidClose | null {
  const own = getBidDeadline(pack.id);
  return own ? { iso: own, source: "pilot" } : packBidClose(pack);
}
