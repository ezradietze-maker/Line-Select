import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { eventInstant, packBidClose, type CalendarPack } from "@/lib/bid-calendar";
import type { BidCalendarEvent, BidPackInfo, Seat } from "@/types/bidpack";

/**
 * A seat's bid timeline, for the pilot's calendar feed: bid close, the conflict input window, View/Add, the SWW,
 * secondary lines and open time release.
 *
 * Best source first:
 *  1. the bid calendar the pack prints on its cover (FedEx's own dates, for this bid and usually the next);
 *  2. with no printed calendar, the bid close (the pilot's own, or `packBidClose`) and the contract's fixed offsets;
 *  3. for windows the contract gives only a minimum for, the usual day from the union's bidding timeline chart,
 *     always marked `estimated`.
 * With no close to count from there is no timeline: 25.C.4 only says Captains close "between 21 and 17 days prior to
 * the commencement of the new bid period", so nothing is worked back from `bidPeriodStart`.
 */

export type TimelineSource = "pilot" | "pack" | "contract" | "estimated";
export type TimelineKind =
  | "bid-close"
  | "conflict-open"
  | "conflict-close"
  | "view-add-open"
  | "view-add-close"
  | "sww-open"
  | "sww-close"
  | "secondary-lines"
  | "open-time";

export interface TimelineEvent {
  /** The bid it belongs to ("DEC26"), which is the month after the one it falls in. */
  bidMonth: string;
  seat: Seat;
  kind: TimelineKind;
  /** ISO instant, UTC. */
  at: string;
  label: string;
  source: TimelineSource;
  /** Where the time comes from, in the words shown on the event. */
  basis: string;
}

export type TimelinePack = CalendarPack & { info?: Pick<BidPackInfo, "openTimeRelease"> };

const CENTRAL = "America/Chicago";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PRINTED_BASIS = "As printed on your bid pack's cover.";

const LABELS: Record<TimelineKind, string> = {
  "bid-close": "bid closes",
  "conflict-open": "conflict input window opens",
  "conflict-close": "conflict input window closes",
  "view-add-open": "View/Add window opens",
  "view-add-close": "View/Add window closes",
  "sww-open": "SWW opens",
  "sww-close": "SWW closes",
  "secondary-lines": "secondary lines released",
  "open-time": "open time released",
};

function event(bidMonth: string, seat: Seat, kind: TimelineKind, at: string, source: TimelineSource, basis: string): TimelineEvent {
  return { bidMonth, seat, kind, at, label: `${bidMonth} ${LABELS[kind]}`, source, basis };
}

const monthIndex = (code: string): number | null => {
  const m = code.match(/^([A-Z]{3})(\d{2})$/i);
  const month = m ? MONTHS.indexOf(m[1].toUpperCase()) : -1;
  return m && month >= 0 ? Number(m[2]) * 12 + month : null;
};

/**
 * Implementation LOA, Phase 2: 25.C.4, 25.C.11, 25.E.2, 25.E.3 and 25.E.6 are "effective the first day of the December
 * 2026 bid period". A bid runs during the period before its own, so the DEC26 bid closes before that day and the JAN27
 * bid is the first to close after it. This reading only reaches a pack with no printed calendar, since a printed date
 * always wins. Question for the ex-pilot: does the DEC26 bid run on the 2015 times?
 */
export function timelineRules(bidMonth: string): "2015" | "2026" {
  const i = monthIndex(bidMonth);
  return i !== null && i >= monthIndex("JAN27")! ? "2026" : "2015";
}

const seatRe = (seat: Seat) => (seat === "CAP" ? /\bCap(?:tain)?\b/i : /\bF\s*\/\s*O\b/i);

function printedKind(text: string, seat: Seat): TimelineKind | null {
  const mine = seatRe(seat).test(text);
  if (/\bITU\b|\bVacation\b|\bVac\b|\bExpense\b|\bTraining\b/i.test(text)) return null;
  if (/Secondary\s+Lines\s+Release/i.test(text)) return "secondary-lines";
  if (/^OT\s+Release/i.test(text)) return "open-time";
  if (/\bBid\s+Closes\b/i.test(text)) return mine ? "bid-close" : null;
  if (/Conflict\s+Input\b.*\bOpens\b/i.test(text)) return mine ? "conflict-open" : null;
  if (/Conflict\s+Input\b.*\bCloses\b/i.test(text)) return mine ? "conflict-close" : null;
  if (/View\s*\/\s*Add\b.*\bOpens\b/i.test(text)) return "view-add-open";
  if (/View\s*\/\s*Add\b.*\bCloses\b/i.test(text)) return "view-add-close";
  if (/\bSWW\b.*\bOpens\b/i.test(text)) return "sww-open";
  if (/\bSWW\b.*\bClose/i.test(text)) return "sww-close";
  return null;
}

/** "OT Release CAP 1915 LBT F/O 2115 LBT" prints both seats in one cell: this seat's own time. */
function seatOpenTime(ev: BidCalendarEvent, seat: Seat): BidCalendarEvent {
  const m = ev.text.match(seat === "CAP" ? /\bCAP\s+(\d{2})(\d{2})\s+(CT|LBT)\b/i : /\bF\s*\/\s*O\s+(\d{2})(\d{2})\s+(CT|LBT)\b/i);
  return m ? { ...ev, time: `${m[1]}:${m[2]}`, zone: m[3].toUpperCase() as "CT" | "LBT" } : ev;
}

/**
 * The printed events for this seat, each under its bid. Most cells name their bid ("NOV26 View/Add…"); the rest
 * ("CAP Conflict Input Window Opens", "OT Release…") belong to the bid most recently opened above them.
 */
function printedTimeline(pack: TimelinePack): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  let current: string | null = null;
  for (const ev of [...(pack.bidCalendar ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const opens = ev.text.match(/^([A-Z]{3}\d{2})\s+Bid\s+Opens\b/i);
    if (opens) current = opens[1].toUpperCase();
    const kind = printedKind(ev.text, pack.seat);
    if (!kind) continue;
    const bidMonth = ev.text.match(/^([A-Z]{3}\d{2})\b/)?.[1].toUpperCase() ?? current;
    if (!bidMonth) continue;
    const at = eventInstant(kind === "open-time" ? seatOpenTime(ev, pack.seat) : ev, pack.base);
    if (at) out.push(event(bidMonth, pack.seat, kind, at, "pack", PRINTED_BASIS));
  }
  return out;
}

const iso = (dt: DateTime) => dt.toUTC().toISO()!;

/**
 * Everything counted from the bid close. A window with only a contract minimum takes its usual day from the union's
 * chart (`private/contract/2026/qa/25-bidding-timeline-chart.png`); the 2015 days match the real OCT26 and NOV26 pack
 * covers, which also print the SWW closing at 0700 CT and secondary lines at 1700 LBT where the chart's 2015 column
 * differs.
 */
function countedTimeline(pack: TimelinePack, close: string, closeSource: TimelineSource, closeBasis: string): TimelineEvent[] {
  const rules = timelineRules(pack.month);
  const seat = pack.seat;
  const ownClose = DateTime.fromISO(close, { zone: CENTRAL });
  if (!ownClose.isValid) return [];
  const baseZone = timezoneForAirport(pack.base) ?? CENTRAL;
  // CBA 2026 25.C.4 (from JAN27, see `timelineRules`): "First Officer bids shall close at 0700 CT on the 2nd day
  // following the close of the Captains' bid". CBA 2015 25.C.4: First Officers "shall close 24 hours following".
  const captainsDay = (seat === "CAP" ? ownClose : ownClose.minus({ days: rules === "2026" ? 2 : 1 })).startOf("day");
  const onDay = (days: number, time: string, zone: string = CENTRAL) => {
    const [hour, minute] = time.split(":").map(Number);
    return captainsDay.plus({ days }).setZone(zone, { keepLocalTime: true }).set({ hour, minute });
  };
  const est = (rule: string) => `Estimated: the usual day on the union's bidding timeline chart (${rule}). Check VIPS.`;
  const estimated = (kind: TimelineKind, dt: DateTime, rule: string) => event(pack.month, seat, kind, iso(dt), "estimated", est(rule));
  const printedOt = pack.info?.openTimeRelease;
  const openTime = printedOt ?? (seat === "CAP" ? "20:00" : "22:00");

  const events = [event(pack.month, seat, "bid-close", iso(ownClose), closeSource, closeBasis)];
  if (rules === "2026") {
    // CBA 2026 25.E.2: the window opens "5 hours following the close of the monthly bid", for "not less than 48 hours".
    events.push(event(pack.month, seat, "conflict-open", iso(ownClose.plus({ hours: 5 })), "contract", "CBA 2026 25.E.2: 5 hours after the bid closes."));
    events.push(estimated("conflict-close", seat === "CAP" ? onDay(3, "07:00") : onDay(4, "12:00"), "25.E.2 sets a 48-hour minimum"));
    // 25.E.3: conflict processing "not less than 5 hours"; 25.E.4: View/Add "not less than 48 hours".
    events.push(estimated("view-add-open", onDay(5, "07:00"), "25.E.3 sets a 5-hour minimum before it"));
    events.push(estimated("view-add-close", onDay(7, "07:00"), "25.E.4 sets a 48-hour minimum"));
    // 25.E.6: "not less than 115 hours beginning at 1700 CT the day following the posting of the View/Add Processing Window results".
    events.push(estimated("sww-open", onDay(8, "17:00"), "25.E.6 fixes 1700 CT, the day after results post"));
    events.push(estimated("sww-close", onDay(13, "12:00"), "25.E.6 sets a 115-hour minimum"));
    events.push(estimated("secondary-lines", onDay(15, "17:00"), "25.C.11 sets the latest day"));
    events.push(estimated("open-time", onDay(17, openTime, baseZone), "25.G.2.a sets the latest day"));
  } else {
    // CBA 2015 25.E.2: "beginning at 1700 CT on the date the bid closes", for "not less than 48 hours".
    const opens = ownClose.set({ hour: 17, minute: 0 });
    events.push(event(pack.month, seat, "conflict-open", iso(opens), "contract", "CBA 2015 25.E.2: 1700 CT on the date the bid closes."));
    events.push(estimated("conflict-close", seat === "CAP" ? onDay(3, "07:00") : onDay(4, "07:00"), "25.E.2 sets a 48-hour minimum"));
    events.push(estimated("view-add-open", onDay(5, "07:00"), "25.E.3 sets a 24-hour minimum before it"));
    events.push(estimated("view-add-close", onDay(7, "07:00"), "25.E.4 sets a 48-hour minimum"));
    events.push(estimated("sww-open", onDay(8, "12:00"), "25.E.6 starts it at the View/Add results"));
    events.push(estimated("sww-close", onDay(13, "07:00"), "25.E.6 sets a minimum"));
    events.push(estimated("secondary-lines", onDay(15, "17:00", baseZone), "25.C.11 sets the latest day"));
    events.push(estimated("open-time", onDay(16, openTime, baseZone), "25.G.2.a sets the latest day"));
  }
  return events;
}

/**
 * The timeline this pack's cover and the pilot's own close give. A close the pilot typed replaces the printed one, as
 * it does on the countdown (`effectiveBidClose`): they may know of a change the pack doesn't show.
 */
export function bidTimeline(pack: TimelinePack, pilotClose: string | null = null): TimelineEvent[] {
  const printed = printedTimeline(pack);
  const pilotEvent = pilotClose ? event(pack.month, pack.seat, "bid-close", new Date(pilotClose).toISOString(), "pilot", "The time you set in Line Select.") : null;
  let events: TimelineEvent[];
  if (printed.some((e) => e.bidMonth === pack.month)) {
    events = pilotEvent ? [...printed.filter((e) => !(e.bidMonth === pack.month && e.kind === "bid-close")), pilotEvent] : printed;
  } else {
    const fromPack = packBidClose(pack);
    const close = pilotClose ? pilotEvent!.at : fromPack?.iso;
    if (!close) return printed;
    const basis = pilotClose ? pilotEvent!.basis : "CBA 2026 25.C.4, counted from the bid opening your pack prints.";
    events = [...printed, ...countedTimeline(pack, close, pilotClose ? "pilot" : "contract", basis)];
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
