import { timezoneForAirport } from "@/lib/airport-timezones";
import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { isStandbyLeg } from "@/lib/standby";
import type { Trip, TripLeg } from "@/types/bidpack";

/**
 * Everything the metric library measures, laid out once per trip in real
 * units: every leg with its printed local clocks and elapsed minutes, every
 * duty and its legs, every layover with its city, length, local hours and
 * region, and the trip's two ends — whether it opens or closes with a
 * deadhead, and how much slack sits between that deadhead and the flying.
 *
 * All times come from the bid pack's own printed clocks and the parser's
 * elapsed minutes (`startMinutes`/`endMinutes`, minutes since the trip's
 * first report). Nothing here is estimated; where the pack doesn't print a
 * thing, the field is null rather than guessed.
 */

export type Region = "domestic" | "alaska" | "hawaii" | "americas" | "asia" | "oceania" | "europe" | "middleEast" | "africa" | "unknown";

export interface LegFact {
  flightNumber: string;
  from: string;
  to: string;
  deadhead: boolean;
  /** Minutes since the trip's first report. */
  start: number;
  end: number;
  /** Local wall clock as printed, minutes after midnight at that airport. */
  depLocalMinute: number | null;
  arrLocalMinute: number | null;
  blockHours: number | null;
  equipment: string;
}

export interface DutyFact {
  index: number;
  start: number;
  /** Last leg's block-in (no release time is printed). */
  end: number;
  legs: LegFact[];
  operatedLegs: number;
  deadheadLegs: number;
  standby: boolean;
  /** The duty's hotel-standby rows (on-call windows), with their local clocks. */
  standbyLegs: LegFact[];
  /** Minutes of operated flying or on-call standby that fall in the local small hours (00:00–05:00) — the time a body wants to be asleep. */
  deepNightMinutes: number;
  /** Report local time at the duty's first airport, minutes after midnight, when the duty starts with a leg. */
  reportLocalMinute: number | null;
}

export interface LayoverFact {
  city: string;
  hours: number;
  start: number;
  end: number;
  /** Local clock at the city when the layover starts / ends, minutes after midnight. */
  localStartMinute: number | null;
  localEndMinute: number | null;
  region: Region;
  international: boolean;
  /** Hours of the layover that fall in the local night (22:00–07:00) — the part a body can actually sleep through. */
  localNightHours: number | null;
  hotel: string | null;
}

export interface TripEnd {
  /** The deadhead legs before the first operated leg (or after the last one), in order. */
  legs: LegFact[];
  /** Where the flying starts (front) or where the pilot is when flying ends (back). */
  city: string | null;
  /** Hours between the front deadhead's arrival and the first operated departure — or between the last operated arrival and the back deadhead's departure. */
  slackHours: number | null;
}

export interface TripFacts {
  trip: Trip;
  duties: DutyFact[];
  legs: LegFact[];
  layovers: LayoverFact[];
  operatedLegs: LegFact[];
  /** Null when the trip has no deadhead before its first operated leg. */
  front: TripEnd | null;
  back: TripEnd | null;
  /** Trip has no operated flying at all (standby or deadhead only). */
  noFlying: boolean;
  tafbHours: number;
  creditHours: number;
  blockHours: number | null;
}

const NIGHT_START = 22 * 60;
const NIGHT_END = 7 * 60;

function hhmmToMinute(hhmm: string | undefined): number | null {
  if (!hhmm || !/^\d{4}$/.test(hhmm)) return null;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

export function regionOf(city: string): Region {
  const zone = timezoneForAirport(city);
  if (!zone) return "unknown";
  if (zone === "Pacific/Honolulu") return "hawaii";
  if (zone === "America/Anchorage" || zone === "America/Juneau" || zone === "America/Nome" || zone === "America/Adak") return "alaska";
  if (zone.startsWith("America/")) return isInternationalCity(city) ? "americas" : "domestic";
  if (zone.startsWith("Asia/")) {
    return /^(Asia\/(Dubai|Riyadh|Qatar|Bahrain|Kuwait|Muscat|Tehran|Baghdad|Jerusalem|Tel_Aviv|Amman|Beirut))/.test(zone) ? "middleEast" : "asia";
  }
  if (zone.startsWith("Australia/") || zone === "Pacific/Auckland" || zone === "Pacific/Guam" || zone === "Pacific/Saipan") return "oceania";
  if (zone.startsWith("Pacific/")) return "oceania";
  if (zone.startsWith("Europe/") || zone.startsWith("Atlantic/")) return "europe";
  if (zone.startsWith("Africa/")) return "africa";
  return "unknown";
}

/** Hours of [startMinute, startMinute + hours) that fall inside the local 22:00–07:00 night, across however many nights the span covers. */
export function nightOverlapHours(localStartMinute: number, hours: number): number {
  const total = Math.round(hours * 60);
  let overlap = 0;
  // Walk the span a minute-block at a time in 15-minute steps — exact enough, and simple to trust.
  for (let t = 0; t < total; t += 15) {
    const clock = (localStartMinute + t) % 1440;
    if (clock >= NIGHT_START || clock < NIGHT_END) overlap += Math.min(15, total - t);
  }
  return overlap / 60;
}

const DEEP_NIGHT_END = 5 * 60;

/**
 * Minutes of an interval that fall between 00:00 and 05:00 on a local clock, given where it starts on that clock and
 * how long it runs — so a 22:00 departure landing at 05:30 counts its whole night, not just its two ends.
 */
export function deepNightOverlapMinutes(localStartMinute: number | null, minutes: number): number {
  if (localStartMinute === null || !(minutes > 0)) return 0;
  let overlap = 0;
  // Walk each local midnight the interval touches.
  const start = localStartMinute;
  const end = localStartMinute + minutes;
  for (let midnight = 0; midnight < end; midnight += 1440) {
    const lo = Math.max(start, midnight);
    const hi = Math.min(end, midnight + DEEP_NIGHT_END);
    if (hi > lo) overlap += hi - lo;
  }
  return overlap;
}

const NIGHT_FROM = 0; // midnight
const NIGHT_TO = 5 * 60; // 05:00
/** A night counts as worked once it holds this much flying or on-call standby. */
export const NIGHT_WORKED_MINUTES = 30;

/**
 * The nights of a trip a pilot spends working. Night k is the small hours, 00:00–05:00, of the trip's day k — the
 * hours a body has to be asleep for; an evening that runs to 23:30 still sleeps the night. A night is worked when
 * operated flying or hotel standby fills at least half an hour of it, so a nightly shuttle (out at 02:00, back just
 * before midnight, out again at 01:00) counts every night, even though each night is split across two duty periods.
 *
 * The small hours on either clock: the base's (the one a body keeps at home) or the one where the pilot is. A week of
 * 03:00 departures out of Oakland is a week of all-nighters for a Memphis pilot even though it's 05:00 in Memphis — on
 * the base clock alone that line counted one night worked. Counting the local clock wherever the pilot is (rather than
 * only within a few hours of home) matched how pilots judge it best on the eval panel (Oct 13 2026: the body-clock
 * pilot +0.05–0.08 Spearman, nobody worse).
 */
export function nightsWorked(f: TripFacts): number[] {
  const report = f.duties[0]?.reportLocalMinute;
  if (report === null || report === undefined) return [];
  const legs = f.duties.flatMap((d) => [...d.legs.filter((l) => !l.deadhead), ...d.standbyLegs]);
  const minutes = new Map<number, number>();
  const count = (a: number, b: number, into: Map<number, number>) => {
    for (let k = Math.floor((a - NIGHT_FROM) / 1440); k * 1440 + NIGHT_FROM < b; k++) {
      const lo = Math.max(a, k * 1440 + NIGHT_FROM);
      const hi = Math.min(b, k * 1440 + NIGHT_TO);
      if (hi > lo) into.set(k, (into.get(k) ?? 0) + (hi - lo));
    }
  };
  const local = new Map<number, number>();
  for (const l of legs) {
    const a = report + l.start;
    const b = report + l.end;
    count(a, b, minutes);
    // The same leg on the local clock where it departs: the base clock shifted by however far local time is from it.
    if (l.depLocalMinute !== null) {
      const offset = ((((l.depLocalMinute - (a % 1440)) % 1440) + 1440 + 720) % 1440) - 720;
      if (offset !== 0) count(a + offset, b + offset, local);
    }
  }
  for (const [k, m] of local) minutes.set(k, Math.max(minutes.get(k) ?? 0, m));
  return [...minutes].filter(([, m]) => m >= NIGHT_WORKED_MINUTES).map(([k]) => k).sort((x, y) => x - y);
}

/** A leg's minutes in the small hours, on whichever end's local clock shows more of it (a leg crossing time zones lives on both). */
export function legDeepNightMinutes(l: LegFact): number {
  const minutes = l.end - l.start;
  const fromArrival = l.arrLocalMinute === null ? null : (((l.arrLocalMinute - minutes) % 1440) + 1440) % 1440;
  return Math.max(deepNightOverlapMinutes(l.depLocalMinute, minutes), deepNightOverlapMinutes(fromArrival, minutes));
}

function legFact(leg: TripLeg): LegFact {
  return {
    flightNumber: leg.flightNumber,
    from: leg.depAirport,
    to: leg.arrAirport,
    deadhead: leg.isDeadhead,
    start: leg.startMinutes,
    end: leg.endMinutes,
    depLocalMinute: hhmmToMinute(leg.depTimeLocal),
    arrLocalMinute: hhmmToMinute(leg.arrTimeLocal),
    blockHours: leg.blockHours,
    equipment: leg.equipment,
  };
}

export function computeTripFacts(trip: Trip): TripFacts {
  const duties: DutyFact[] = trip.schedule.map((duty, index) => {
    const flown = duty.legs.filter((l) => !isStandbyLeg(l));
    const legs = flown.map(legFact);
    const standbyLegs = duty.legs.filter((l) => isStandbyLeg(l)).map(legFact);
    const first = duty.legs[0];
    return {
      index,
      start: duty.startMinutes,
      end: duty.legs.length ? duty.legs[duty.legs.length - 1].endMinutes : duty.startMinutes,
      legs,
      operatedLegs: legs.filter((l) => !l.deadhead).length,
      deadheadLegs: legs.filter((l) => l.deadhead).length,
      standby: standbyLegs.length > 0,
      standbyLegs,
      deepNightMinutes: [...legs.filter((l) => !l.deadhead), ...standbyLegs].reduce((a, l) => a + legDeepNightMinutes(l), 0),
      reportLocalMinute:
        index === 0
          ? hhmmToMinute(duty.reportTimeLocal)
          : first
            ? (() => {
                // Later duties start at the hotel pickup: the printed pickup when there is one, else the first departure less the duty's lead time.
                const prev = trip.schedule[index - 1]?.layover;
                const printed = hhmmToMinute(prev?.pickupTimeLocal);
                if (printed !== null) return printed;
                const dep = hhmmToMinute(first.depTimeLocal);
                return dep === null ? null : (((dep - (first.startMinutes - duty.startMinutes)) % 1440) + 1440) % 1440;
              })()
            : null,
    };
  });

  const legs = duties.flatMap((d) => d.legs);
  const operatedLegs = legs.filter((l) => !l.deadhead);

  const layovers: LayoverFact[] = trip.schedule.flatMap((duty) => {
    if (!duty.layover) return [];
    const lastLeg = duty.legs[duty.legs.length - 1];
    const localStart = hhmmToMinute(lastLeg?.arrTimeLocal);
    const city = duty.layover.city;
    return [
      {
        city,
        hours: duty.layover.hours,
        start: duty.layover.startMinutes,
        end: duty.layover.endMinutes,
        localStartMinute: localStart,
        localEndMinute: localStart === null ? null : Math.round(localStart + duty.layover.hours * 60) % 1440,
        region: regionOf(city),
        international: isInternationalCity(city),
        localNightHours: localStart === null ? null : nightOverlapHours(localStart, duty.layover.hours),
        hotel: duty.layover.hotelName,
      },
    ];
  });

  const firstOp = legs.findIndex((l) => !l.deadhead);
  let lastOp = -1;
  for (let i = legs.length - 1; i >= 0; i--) {
    if (!legs[i].deadhead) {
      lastOp = i;
      break;
    }
  }

  // Hotel standby is on-call work: no one deviates through it, so slack ends where standby begins (front) or starts where it ends (back).
  const standby = trip.schedule.flatMap((d) => d.legs.filter((l) => isStandbyLeg(l)).map((l) => ({ start: l.startMinutes, end: l.endMinutes })));
  const front: TripEnd | null =
    firstOp > 0
      ? (() => {
          const arrive = legs[firstOp - 1].end;
          const until = Math.min(legs[firstOp].start, ...standby.filter((s) => s.start >= arrive && s.start < legs[firstOp].start).map((s) => s.start));
          return { legs: legs.slice(0, firstOp), city: legs[firstOp].from, slackHours: Math.max(0, until - arrive) / 60 };
        })()
      : null;
  const back: TripEnd | null =
    lastOp >= 0 && lastOp < legs.length - 1
      ? (() => {
          const leave = legs[lastOp + 1].start;
          const from = Math.max(legs[lastOp].end, ...standby.filter((s) => s.end <= leave && s.end > legs[lastOp].end).map((s) => s.end));
          return { legs: legs.slice(lastOp + 1), city: legs[lastOp].to, slackHours: Math.max(0, leave - from) / 60 };
        })()
      : null;

  const blocks = operatedLegs.map((l) => l.blockHours);
  return {
    trip,
    duties,
    legs,
    layovers,
    operatedLegs,
    front,
    back,
    noFlying: operatedLegs.length === 0,
    tafbHours: trip.tafbHours,
    creditHours: trip.creditHours,
    blockHours: blocks.length && blocks.every((b) => b !== null) ? blocks.reduce((a, b) => a + (b ?? 0), 0) : null,
  };
}
