import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { bidTimeline, type TimelineEvent } from "@/lib/bid-timeline";
import { backupsOf, type TravelAnswer } from "@/lib/flights/itineraries";
import { flightsForTrip, type FlightAnswers } from "@/lib/flights/trip-travel";
import { escapeIcsText, foldLine, icsUtc } from "@/lib/ics-export";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack, Line, Trip, TripDutyPeriod } from "@/types/bidpack";

/**
 * A pilot's private calendar subscription (`/api/calendar/[token]`): the bid timeline for their seat, their awarded or
 * #1 line's trips, and, if they want them, their days off. A month is built once, when the pilot's choice changes, and
 * kept with the feed (`FeedMonth`), because the pack it came from is replaced next month while they're still flying
 * it. Refreshing a calendar then only reads one row and costs nothing.
 */

export type LineSource = "awarded" | "top";

export interface FeedTrip {
  uid: string;
  /** Epoch ms. */
  start: number;
  end: number;
  summary: string;
  description: string;
}

/** A run of days off: `start` to `end` (exclusive), "YYYY-MM-DD". */
export interface FeedHomeDays {
  uid: string;
  start: string;
  end: string;
}

export interface FeedMonth {
  packId: string;
  /** "DEC26". */
  month: string;
  /** Epoch ms this month was built: the events' DTSTAMP, so an unchanged feed reads back byte for byte the same. */
  builtAt: number;
  lineNumber: string | null;
  lineSource: LineSource | null;
  trips: FeedTrip[];
  homeDays: FeedHomeDays[];
  timeline: TimelineEvent[];
}

export interface FeedOptions {
  /** Days off as all-day "Home" events. */
  homeDays: boolean;
}

export const DEFAULT_FEED_OPTIONS: FeedOptions = { homeDays: false };

/** Asked of the calendar app in the feed itself; Apple Calendar and Outlook honor it, Google sets its own pace. */
export const REFRESH_HOURS = 6;
/** The current month, the one being flown, and the one before it, which may still be running or carrying over. */
const MONTHS_KEPT = 3;

const clock = (hhmm: string | undefined) => (hhmm && /^\d{4}$/.test(hhmm) ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : null);
const withPhone = (name: string | null | undefined, phone: string | undefined) => (name ? (phone ? `${name}, ${phone}` : name) : null);

/** A layover's hotel, rides and pickup, exactly as the pack prints them for this trip's date. */
function layoverLines(duty: TripDutyPeriod, n: number): string[] {
  const lay = duty.layover;
  if (!lay) return [];
  const hours = Number.isFinite(lay.hours) ? ` (${lay.hours.toFixed(1)} hours)` : "";
  const pickup = clock(lay.pickupTimeLocal);
  return [
    `Layover ${n}: ${lay.city}${hours}`,
    lay.hotelName ? `Hotel: ${withPhone(lay.hotelName, lay.hotelPhone)}` : null,
    lay.transportToHotel ? `Ride to hotel: ${withPhone(lay.transportToHotel, lay.transportToPhone)}` : null,
    pickup ? `Pickup: ${pickup} ${lay.city} time` : null,
    lay.transportFromHotel ? `Ride back: ${withPhone(lay.transportFromHotel, lay.transportFromPhone)}` : null,
  ].filter((l): l is string => !!l);
}

function itinerary(a: TravelAnswer): string | null {
  if (!a.best?.length) return null;
  const local = (ms: number, airport: string) => DateTime.fromMillis(ms, { zone: timezoneForAirport(airport) ?? "UTC" }).toFormat("ccc LLL d HH:mm");
  const first = a.best[0];
  const last = a.best[a.best.length - 1];
  const route = [first.from, ...a.best.map((f) => f.to)].join(" > ");
  const flights = a.best.map((f) => (f.jumpseat ? `${f.n} (jumpseat)` : f.n)).join(" + ");
  const backups = backupsOf(a);
  return `${route}, ${flights}: leaves ${local(first.dep, first.from)}, lands ${local(last.arr, last.to)}${backups > 0 ? ` (${backups} backup${backups === 1 ? "" : "s"})` : ""}`;
}

function commuteLines(flights: FlightAnswers | undefined, trip: Trip): string[] {
  const t = flightsForTrip(flights, trip);
  if (!t) return [];
  const rows: [string, TravelAnswer | undefined][] = [
    ["Commute in", t.toBase],
    ["Straight to the trip", t.deviateOut],
    ["Commute home", t.homeFromBase],
    ["Home from the trip's end", t.deviateHome],
  ];
  const lines = rows.flatMap(([label, a]) => {
    const text = a && itinerary(a);
    return text ? [`${label}: ${text}`] : [];
  });
  return lines.length ? ["", ...lines, "Suggested from airline schedules. They change, so check before relying on one."] : [];
}

/** Report to release, in the base's own local time, with the pack's hotels and rides and any commute flights. */
function feedTrip(pack: Pick<BidPack, "month" | "base" | "bidPeriodStart">, line: Line, source: LineSource, trip: Trip, flights: FlightAnswers | undefined): FeedTrip | null {
  const start = tripReportUtc(pack, trip);
  if (start === null) return null;
  const last = trip.schedule[trip.schedule.length - 1]?.legs.at(-1);
  // TAFB as printed runs report to release; the last landing stands in on the rare trip without one.
  const end = trip.tafbHours > 0 ? start + trip.tafbHours * 3_600_000 : last ? start + last.endMinutes * 60_000 : start + 3_600_000;
  const zone = timezoneForAirport(pack.base) ?? "UTC";
  const local = (ms: number) => DateTime.fromMillis(ms, { zone }).toFormat("ccc LLL d HH:mm");
  const name = trip.pairingNumber ? `Trip ${trip.pairingNumber}` : `Line ${line.lineNumber} trip`;
  const cities = trip.layoverCities.length > 0 ? trip.layoverCities.join(", ") : "no layovers";
  const date = DateTime.fromMillis(start, { zone }).toFormat("yyyyLLdd");
  let layover = 0;
  const description = [
    source === "awarded" ? `Line ${line.lineNumber}: your award.` : `Line ${line.lineNumber}: your #1 in Line Select right now. Not an award.`,
    `Report: ${local(start)} ${pack.base} time`,
    `Release: ${local(end)} ${pack.base} time`,
    `${trip.days}-day trip, ${trip.creditHours.toFixed(1)} credit hours`,
    ...trip.schedule.flatMap((d) => {
      if (!d.layover) return [];
      layover += 1;
      return ["", ...layoverLines(d, layover)];
    }),
    ...commuteLines(flights, trip),
  ].join("\n");
  return {
    // Named after the trip and its date, not the line: a trip shared by the old #1 and the new one stays one event.
    uid: `trip-${pack.month}-${trip.pairingNumber ?? trip.id}-${date}@lineselect`,
    start,
    end,
    summary: `${name}: ${cities}${source === "top" ? " (your #1)" : ""}`,
    description,
  };
}

/** The line's own printed days off, as runs of days. Only days inside the bid period: the grid can print a few beyond it. */
function homeDaysOf(pack: Pick<BidPack, "month" | "bidPeriodStart" | "bidPeriodDays">, line: Line): FeedHomeDays[] {
  if (!pack.bidPeriodStart || !line.gridOffDays) return [];
  const first = DateTime.fromISO(pack.bidPeriodStart, { zone: "utc" });
  const days = [...new Set(line.gridOffDays)].filter((d) => d >= 0 && d < pack.bidPeriodDays).sort((a, b) => a - b);
  const runs: FeedHomeDays[] = [];
  let from: number | null = null;
  days.forEach((d, i) => {
    from ??= d;
    if (days[i + 1] === d + 1) return;
    const start = first.plus({ days: from }).toFormat("yyyy-LL-dd");
    runs.push({ uid: `home-${pack.month}-${start}@lineselect`, start, end: first.plus({ days: d + 1 }).toFormat("yyyy-LL-dd") });
    from = null;
  });
  return runs;
}

export interface FeedMonthInput {
  /** The line to show, or null when there's none yet, or the award wasn't a line. */
  lineNumber: string | null;
  lineSource: LineSource | null;
  /** The bid close the pilot typed in, if they did. */
  pilotClose?: string | null;
  flights?: FlightAnswers;
  now?: number;
}

export function buildFeedMonth(pack: BidPack, input: FeedMonthInput): FeedMonth {
  const line = input.lineNumber ? (pack.lines.find((l) => l.lineNumber === input.lineNumber) ?? null) : null;
  const source = line ? input.lineSource : null;
  return {
    packId: pack.id,
    month: pack.month,
    builtAt: input.now ?? Date.now(),
    lineNumber: line?.lineNumber ?? null,
    lineSource: source,
    trips: line && source ? line.trips.flatMap((t) => feedTrip(pack, line, source, t, input.flights) ?? []) : [],
    homeDays: line ? homeDaysOf(pack, line) : [],
    timeline: bidTimeline(pack, input.pilotClose ?? null),
  };
}

/** This month in place of any earlier build of it, newest month first, keeping the last few. Ordered by each month's own first date. */
export function withFeedMonth(months: FeedMonth[], month: FeedMonth): FeedMonth[] {
  const firstDate = (m: FeedMonth) => Math.min(...m.trips.map((t) => t.start), ...m.timeline.map((t) => Date.parse(t.at)), m.builtAt);
  return [...months.filter((m) => m.month !== month.month), month].sort((a, b) => firstDate(b) - firstDate(a)).slice(0, MONTHS_KEPT);
}

const timelineUid = (e: TimelineEvent) => `bid-${e.bidMonth}-${e.seat}-${e.kind}@lineselect`;
const timelineSummary = (e: TimelineEvent) => (e.source === "estimated" ? `${e.label} (estimated)` : e.label);
const dateValue = (iso: string) => iso.replace(/-/g, "");

function vevent(uid: string, stamp: number, props: string[]): string[] {
  return ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsUtc(stamp)}`, `LAST-MODIFIED:${icsUtc(stamp)}`, ...props, "END:VEVENT"];
}

/**
 * The feed as RFC 5545 text. Times are UTC, so a phone in any time zone shows the right moment; the base's local times
 * are spelled out in each trip's description. Newest build wins when two months describe the same event: a pack's
 * cover prints the next bid's dates too, and that bid's own pack is the better source.
 */
export function renderFeed(months: FeedMonth[], options: FeedOptions): string {
  const events = new Map<string, string[]>();
  const add = (uid: string, lines: string[]) => {
    if (!events.has(uid)) events.set(uid, lines);
  };
  const newestBuildFirst = [...months].sort((a, b) => b.builtAt - a.builtAt);
  for (const m of newestBuildFirst) {
    for (const e of m.timeline) {
      const at = Date.parse(e.at);
      if (!Number.isFinite(at)) continue;
      const uid = timelineUid(e);
      add(uid, vevent(uid, m.builtAt, [
        `DTSTART:${icsUtc(at)}`,
        `DTEND:${icsUtc(at + 30 * 60_000)}`,
        `SUMMARY:${escapeIcsText(timelineSummary(e))}`,
        `DESCRIPTION:${escapeIcsText(e.basis)}`,
        "TRANSP:TRANSPARENT",
      ]));
    }
    for (const t of m.trips) {
      add(t.uid, vevent(t.uid, m.builtAt, [
        `DTSTART:${icsUtc(t.start)}`,
        `DTEND:${icsUtc(t.end)}`,
        `SUMMARY:${escapeIcsText(t.summary)}`,
        `DESCRIPTION:${escapeIcsText(t.description)}`,
      ]));
    }
    if (options.homeDays) {
      for (const h of m.homeDays) {
        add(h.uid, vevent(h.uid, m.builtAt, [
          `DTSTART;VALUE=DATE:${dateValue(h.start)}`,
          `DTEND;VALUE=DATE:${dateValue(h.end)}`,
          "SUMMARY:Home",
          "TRANSP:TRANSPARENT",
        ]));
      }
    }
  }
  const sorted = [...events.keys()].sort();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Line Select//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Line Select",
    `X-WR-CALDESC:${escapeIcsText("Your bid timeline and trips, from Line Select. Check VIPS for your official schedule.")}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${REFRESH_HOURS}H`,
    `X-PUBLISHED-TTL:PT${REFRESH_HOURS}H`,
    ...sorted.flatMap((uid) => events.get(uid)!),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
