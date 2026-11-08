import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { newCloseRuleApplies } from "@/lib/bid-calendar";
import { lineCarryOver, splitTrip } from "@/lib/bid-month";
import { longestDaysOffBlock } from "@/lib/days-off-pattern";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { VipsBidAnswers } from "@/lib/vips-bid";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Bid Period Phase-In: what last month's carry-in does to each line of the new month (CBA 2026 25.F). A pilot's current
 * schedule takes precedence over the new award (25.F.3), so a new trip the carry-in stops them flying is dropped without
 * pay and its CH value can be made up in View/Add (25.F.5). This works that out line by line, so the line can be scored
 * as it will really fly.
 *
 * Where the contract's text doesn't settle a case, the finding is `certainty: "check"`: it's told to the pilot but
 * changes nothing on the line. Those questions are in private/ex-pilot/step4-what-we-need-from-you.md.
 *
 * Not modelled, because the pack doesn't say: 25.F.1.a (restricted landing minimums), 25.F.1.c (recurrent training),
 * 25.F.3.b (ITU pay only). Reserve lines aren't ranked, so 25.F.6 and 25.F.8 reach only the pure R-day rules below.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** A trip carried in from last month, with times as real instants. */
export interface CarryInTrip {
  kind: "trip";
  id: string;
  /** How the pilot knows it: "Trip 213". */
  label: string;
  /** ISO instants. */
  report: string;
  release: string;
  /** Flown under international rules (CBA 2026 12.D.1.a), so its buffer and rest apply. */
  international: boolean;
  creditHours?: number | null;
  /** The duty periods, when known (from the Logbook). Typed by hand they aren't, so a 24-hour layover inside it can't be seen. */
  duties?: { start: string; end: string }[];
}

/** CBA 2026 25.M.2.a. */
export type ReservePeriod = "A" | "A+" | "B" | "B+" | "24";

/** A block of R-days carried in from last month. */
export interface CarryInRDays {
  kind: "rdays";
  id: string;
  label: string;
  /** The first R-day on the base's calendar, "YYYY-MM-DD". */
  firstDay: string;
  days: number;
  rp: ReservePeriod;
}

export type CarryInItem = CarryInTrip | CarryInRDays;

/** The pilot's answers on the monthly bid (CBA 2026 25.E.1). */
export type PhaseInElections = Pick<VipsBidAnswers, "waiveBufferPhaseIn" | "waive1in10" | "protectMinDays">;

export const NO_ELECTIONS: PhaseInElections = { waiveBufferPhaseIn: false, waive1in10: false, protectMinDays: false };

/** The numbers that change with the bid period. Phase 2 of the Implementation LOA starts with the December 2026 bid period. */
export interface PhaseInRules {
  /** CBA 2026 12.C.6.a: 9:30 scheduled from December 2026; 9 hours before it. */
  domesticRestMinutes: number;
  /** CBA 2026 12.C.6.a: 8:30 when the next duty is all deadhead, from December 2026; 8 hours before it. */
  domesticDeadheadRestMinutes: number;
  /** CBA 2026 25.L.6.e: a make-up trip may pass eligibility by more than 7 CH from December 2026; 6 before it. */
  makeUpOverageCH: number;
  /** CBA 2026 25.E.1.a: from December 2026 one minimum-days-off election, for phase-in and recurrent training together. */
  minDaysElectionAllInOne: boolean;
}

export function phaseInRules(packMonth: string): PhaseInRules {
  const phase2 = newCloseRuleApplies(packMonth);
  return {
    domesticRestMinutes: phase2 ? 570 : 540,
    domesticDeadheadRestMinutes: phase2 ? 510 : 480,
    makeUpOverageCH: phase2 ? 7 : 6,
    minDaysElectionAllInOne: phase2,
  };
}

/** CBA 2026 12.D.7.a, b: every bid period. */
const INTERNATIONAL_REST_MINUTES = 720;
/** CBA 2026 12.D.1.d.i, ii: the buffers guard an international trip of more than 120 hours TAFB. */
const BUFFER_TAFB_HOURS = 120;
const BUFFER_BEFORE_HOURS = 24;
const BUFFER_AFTER_HOURS = 48;
/** CBA 2026 25.F.1.b.i–iii: every bid period. */
const R_DAY_GAP_HOURS = 12;
/** CBA 2026 25.F.3.a: every bid period. */
const DROP_NEW_TRIP_OVER_TAFB = 120;
const DROP_CARRYOVER_UNDER_TAFB = 72;
const DROP_CARRYOVER_UNDER_RDAYS = 3;
/** CBA 2026 12.C.1.b and 12.D.1.i, 12.C.1.c: both need 24 consecutive hours off, every bid period. */
const RELIEF_HOURS = 24;
const ONE_IN_7_HOURS = 7 * 24;
const ONE_IN_10_HOURS = 240;

const CONUS_ZONE = /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Boise|Detroit|Indiana\/|Kentucky\/|Menominee|North_Dakota\/)/;
const ALASKA_ZONE = /^America\/(Anchorage|Juneau|Sitka|Nome|Yakutat|Metlakatla)$/;
/** Canada, Mexico, Bermuda and Puerto Rico. */
const NEAR_ZONE =
  /^(America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Mexico_City|Cancun|Monterrey|Tijuana|Merida|Mazatlan|Chihuahua|Hermosillo|Puerto_Rico)|Atlantic\/Bermuda)$/;

/**
 * Whether a trip flies under international rules. CBA 2026 12.D.1.a: anything touching a place outside the contiguous
 * 48 states. CBA 2026 12.D.1.c.i takes out "trips that operate entirely within Alaska; or within or between Canada,
 * Mexico, Bermuda, and Puerto Rico, or between any of these locations and the contiguous 48 states". Read literally, so
 * Hawaii and a trip between Alaska and the 48 stay international (question 8 for the ex-pilot).
 * `Trip.international` is a rougher label, made for scoring: it calls Alaska and Hawaii domestic and Canada international.
 */
export function flownUnderInternationalRules(trip: Pick<Trip, "international" | "schedule">): boolean {
  const airports = trip.schedule.flatMap((d) => d.legs.flatMap((l) => [l.depAirport, l.arrAirport]));
  if (!airports.length) return trip.international;
  const zones = airports.map((a) => timezoneForAirport(a));
  if (zones.some((z) => !z)) return trip.international;
  if (zones.every((z) => ALASKA_ZONE.test(z!))) return false;
  return !zones.every((z) => CONUS_ZONE.test(z!) || NEAR_ZONE.test(z!));
}

/**
 * Days off a line must keep: not stated as a number in the text we have. Taken from CBA 2026 25.D.1.b's most work days a
 * regular line may have: 15 in 4 weeks, 19 in 5, 23 in 6. Unconfirmed (question 1 for the ex-pilot), so it only advises.
 */
export function minimumDaysOff(bidPeriodDays: number): number | null {
  const maxWorkDays: Record<number, number> = { 28: 15, 35: 19, 42: 23 };
  const work = maxWorkDays[bidPeriodDays];
  return work === undefined ? null : bidPeriodDays - work;
}

export interface Span {
  start: number;
  end: number;
}

export function zoneOf(pack: Pick<BidPack, "base">): string {
  return timezoneForAirport(pack.base) ?? "UTC";
}

/**
 * CBA 2026 25.A.2: "any local base day, except EUR" starts at 0130 LBT, and "the local EUR base day" at 0215 LBT, in
 * every bid period. Minutes after midnight. The pack's vacation schedule runs on it too: 0630Z is 0130 in Memphis.
 */
export function baseDayStartMinutes(zone: string): number {
  return zone.startsWith("Europe/") ? 135 : 90;
}

/** An R-day's reserve period as real instants. CBA 2026 25.M.2.a. */
export function reservePeriodSpan(day: string, rp: ReservePeriod, zone: string): Span {
  const start = DateTime.fromISO(day, { zone }).plus({ minutes: baseDayStartMinutes(zone) });
  const offset = { A: 0, "A+": 6, B: 12, "B+": 18, "24": 0 }[rp];
  return { start: start.plus({ hours: offset }).toMillis(), end: start.plus({ hours: offset + (rp === "24" ? 24 : 12) }).toMillis() };
}

/**
 * CBA 2026 25.F.1.b.i: "An R-day conflicts with an earlier assignment unless there is at least 12 hours prior to the
 * start of the pilot's first RP". Every bid period.
 */
export function rDayConflictsWithEarlier(earlierEnd: number, firstRpStart: number): boolean {
  return firstRpStart - earlierEnd < R_DAY_GAP_HOURS * HOUR;
}

/**
 * CBA 2026 25.F.1.b.ii: "An R-day conflicts with a subsequent assignment unless there are at least 12 hours between the
 * end of the pilot's R-day and the beginning of the scheduled assignment". Every bid period.
 */
export function rDayConflictsWithLater(rDayEnd: number, assignmentStart: number): boolean {
  return assignmentStart - rDayEnd < R_DAY_GAP_HOURS * HOUR;
}

/**
 * CBA 2026 25.F.1.b.iii: "An R-day conflicts with another R-day unless there are at least 12 hours between the consecutive
 * RPs; however, consecutive R-days with the same RP do not create a conflict". Every bid period.
 */
export function rDayConflictsWithRDay(earlierEnd: number, laterStart: number, sameRp: boolean): boolean {
  if (sameRp) return false;
  return laterStart - earlierEnd < R_DAY_GAP_HOURS * HOUR;
}

/** A piece of the pilot's schedule around the month's change, on one timeline. */
interface Block {
  /** Its duties, in order; one span for a whole block when they aren't known. */
  duties: Span[];
  international: boolean;
  /** Whether the time between `duties` is known. False for a trip typed by hand and for R-days, which may or may not count as relief. */
  dutiesKnown: boolean;
  carry: CarryInItem | null;
  /** A carried-in R-day block: its end for 25.F.1.b.ii, and the calendar day's end. */
  reserve?: { rpEnd: number; dayEnd: number };
}

function carryBlock(item: CarryInItem, zone: string): Block | null {
  if (item.kind === "trip") {
    const start = Date.parse(item.report);
    const end = Date.parse(item.release);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const known = (item.duties ?? []).map((d) => ({ start: Date.parse(d.start), end: Date.parse(d.end) }));
    const duties = known.length ? known : [{ start, end }];
    return { duties, international: item.international, dutiesKnown: known.length > 0, carry: item };
  }
  if (item.days < 1 || !DateTime.fromISO(item.firstDay, { zone }).isValid) return null;
  const first = reservePeriodSpan(item.firstDay, item.rp, zone);
  const lastDay = DateTime.fromISO(item.firstDay, { zone }).plus({ days: item.days - 1 });
  const last = reservePeriodSpan(lastDay.toISODate()!, item.rp, zone);
  return {
    duties: [{ start: first.start, end: last.end }],
    international: false,
    dutiesKnown: false,
    carry: item,
    reserve: { rpEnd: last.end, dayEnd: lastDay.plus({ days: 1, minutes: baseDayStartMinutes(zone) }).toMillis() },
  };
}

/** A trip's duties as real instants. Its layovers are what's between them. */
export function tripSpans(trip: Trip, report: number): Span[] {
  const release = report + trip.tafbHours * HOUR;
  if (!trip.schedule.length) return [{ start: report, end: release }];
  return trip.schedule.map((d) => ({
    start: report + d.startMinutes * MINUTE,
    end: d.layover ? report + d.layover.startMinutes * MINUTE : release,
  }));
}

export type ConflictRule = "overlap" | "rest" | "buffer-before" | "buffer-after" | "one-in-7" | "one-in-10" | "r-day";

/** What the carry-in does to one trip of the new month. */
export interface PhaseInFinding {
  tripId: string;
  pairingNumber: string | null;
  rule: ConflictRule;
  /** The contract section it stands on, as the pilot can look it up: "CBA 2026 25.F.1.b". */
  section: string;
  /** Said plainly: "reports 6.5 hours after Trip 213 ends; the legal rest is 9:30". */
  detail: string;
  /** "clear": the text settles it and the trip is dropped. "check": it's unclear, so the pilot's told and the trip stays. */
  certainty: "clear" | "check";
  /** Which answer on the bid would avoid it. */
  waivedBy: "buffer" | "1-in-10" | null;
  /** The pilot's answers on the bid waive it, so the trip stays. */
  waived: boolean;
}

export interface DroppedTrip {
  trip: Trip;
  /** CH the pilot can make up in View/Add: the CH value of the trip (CBA 2026 25.F.5). */
  makeUpCH: number;
  findings: PhaseInFinding[];
}

/** One way to get back to minimum days off under CBA 2026 25.F.7: the trips, the days it leaves, and the make-up it gives. */
export interface MinDaysOption {
  pairingNumbers: (string | null)[];
  daysOffAfter: number;
  makeUpCH: number;
  /** "25.F.7.a": the line then holds the minimum. "25.F.7.b": no drop lands on it, so it passes the minimum. */
  section: "25.F.7.a" | "25.F.7.b";
}

/** Each line of the new month with the carry-in laid over it. */
export interface FlownLine {
  /** The line as it will fly: dropped trips gone, carried-in days no longer days off. */
  line: Line;
  /** The line's trips couldn't all be put on real dates, so nothing was checked. */
  unchecked: boolean;
  dropped: DroppedTrip[];
  /** Findings that didn't drop a trip: waived, or to check. */
  kept: PhaseInFinding[];
  makeUpCH: number;
  daysOffBefore: number;
  daysOffAfter: number;
  /** Longest run of days off, before and after, when the grid gives it. */
  longestOffBefore: number | null;
  longestOffAfter: number | null;
  /** Under the minimum after carry-in (25.F.7): null when it isn't, or no minimum is known. */
  minDays: { needed: number; have: number; options: MinDaysOption[] } | null;
  /** Things the pilot can do, each naming its section. */
  advice: string[];
  /** One line on what the carry-in does to this line; null when it does nothing. */
  reason: string | null;
}

function hoursText(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return m ? `${h}:${String(m).padStart(2, "0")}` : `${h} hours`;
}

function tripName(trip: Pick<Trip, "pairingNumber">): string {
  return trip.pairingNumber ? `trip ${trip.pairingNumber}` : "a trip";
}

function allDeadheadFirstDuty(trip: Trip): boolean {
  const legs = trip.schedule[0]?.legs ?? [];
  return legs.length > 0 && legs.every((l) => l.isDeadhead);
}

/**
 * CBA 2026 25.F.1.b and 25.F.3: the carry-in against one new trip — overlap, rest and buffers. Only the carry-in's blocks
 * count here: a line's own trips are legal with each other as built.
 */
function findCarryConflicts(trip: Trip, span: Span, blocks: Block[], rules: PhaseInRules, elections: PhaseInElections): PhaseInFinding[] {
  const out: PhaseInFinding[] = [];
  const add = (f: Omit<PhaseInFinding, "tripId" | "pairingNumber">) => out.push({ tripId: trip.id, pairingNumber: trip.pairingNumber, ...f });
  const intl = flownUnderInternationalRules(trip);

  for (const block of blocks) {
    const item = block.carry;
    if (!item) continue;
    const start = block.duties[0].start;
    const end = block.duties[block.duties.length - 1].end;
    // A new trip entirely before the carry-in has nothing to do with it.
    if (span.end <= start) continue;
    const gap = span.start - end;

    if (gap < 0) {
      add({
        rule: "overlap",
        section: "CBA 2026 25.F.1.b, 25.F.3",
        detail: `reports ${hoursText(-gap)} before ${item.label} ends`,
        certainty: "clear",
        waivedBy: null,
        waived: false,
      });
      continue;
    }

    if (block.reserve) {
      // CBA 2026 25.F.1.b.ii. Whether the R-day ends with its RP or its calendar day isn't settled (question 7).
      if (rDayConflictsWithLater(block.reserve.rpEnd, span.start)) {
        add({
          rule: "r-day",
          section: "CBA 2026 25.F.1.b.ii",
          detail: `reports ${hoursText(span.start - block.reserve.rpEnd)} after ${item.label} ends; it needs 12 hours`,
          certainty: "clear",
          waivedBy: null,
          waived: false,
        });
      } else if (rDayConflictsWithLater(block.reserve.dayEnd, span.start)) {
        add({
          rule: "r-day",
          section: "CBA 2026 25.F.1.b.ii",
          detail: `reports ${hoursText(span.start - block.reserve.dayEnd)} after the last day of ${item.label}, though 12 hours or more after its reserve period ends`,
          certainty: "check",
          waivedBy: null,
          waived: false,
        });
      }
    } else {
      // CBA 2026 12.C.6.a and 12.D.7.a, b, e. Measured from the scheduled release (question 5), and international when
      // either side is (question 6).
      const international = block.international || intl;
      const restMinutes = international ? INTERNATIONAL_REST_MINUTES : allDeadheadFirstDuty(trip) ? rules.domesticDeadheadRestMinutes : rules.domesticRestMinutes;
      if (gap < restMinutes * MINUTE) {
        add({
          rule: "rest",
          section: international ? "CBA 2026 12.D.7, 25.F.1.b" : "CBA 2026 12.C.6.a, 25.F.1.b",
          detail: `reports ${hoursText(gap)} after ${item.label} ends; the legal rest is ${hoursText(restMinutes * MINUTE)}`,
          certainty: "clear",
          waivedBy: null,
          waived: false,
        });
        continue;
      }
    }

    // CBA 2026 12.D.1.d.ii, iii and 25.F.4: 48 hours free after an international trip over 120 hours TAFB, waivable.
    if (item.kind === "trip" && item.international && (end - start) / HOUR > BUFFER_TAFB_HOURS && gap < BUFFER_AFTER_HOURS * HOUR) {
      add({
        rule: "buffer-after",
        section: "CBA 2026 12.D.1.d.ii, 25.F.4",
        detail: `reports ${hoursText(gap)} after ${item.label} ends, inside its 48-hour international buffer`,
        certainty: "clear",
        waivedBy: "buffer",
        waived: elections.waiveBufferPhaseIn,
      });
    }
    // CBA 2026 12.D.1.d.i, iii and 25.F.4: 24 hours free before one, waivable. It lets a pilot "be on reserve (during which
    // time the pilot performed no flying or standby duty)" inside the 24 hours, so a carried-in R-day doesn't break it.
    if (item.kind === "trip" && intl && trip.tafbHours > BUFFER_TAFB_HOURS && gap < BUFFER_BEFORE_HOURS * HOUR) {
      add({
        rule: "buffer-before",
        section: "CBA 2026 12.D.1.d.i, 25.F.4",
        detail: `reports ${hoursText(gap)} after ${item.label} ends, inside the 24-hour international buffer before it`,
        certainty: "clear",
        waivedBy: "buffer",
        waived: elections.waiveBufferPhaseIn,
      });
    }
  }
  return out;
}

/**
 * How long the pilot has gone without `reliefHours` off by the end of `span`, counting back through `blocks`. Null when
 * the stretch doesn't reach the carry-in: a line's own trips were built legal.
 *
 * `atBase` counts only time at base as relief, so a layover inside a trip doesn't count, and stops at an international
 * block, since 1-in-10 covers only a period "exclusively" of domestic trips.
 */
function stretchFromCarryIn(span: Span, blocks: Block[], opts: { atBase: boolean; end?: number }): { hours: number; unsure: boolean } | null {
  const pieces = blocks
    .flatMap((b) => (opts.atBase ? [{ start: b.duties[0].start, end: b.duties[b.duties.length - 1].end }] : b.duties).map((d) => ({ ...d, block: b })))
    .sort((a, b) => a.start - b.start);
  let from = span.start;
  let unsure = false;
  let reachesCarry = false;
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.start >= from) continue;
    if (from - p.end >= RELIEF_HOURS * HOUR) break;
    if (opts.atBase && p.block.international) break;
    from = p.start;
    if (p.block.carry) reachesCarry = true;
    // Time off inside it can't be seen: a typed trip's layovers, or whether R-days count as relief.
    if (!p.block.dutiesKnown && !opts.atBase) unsure = true;
    if (p.block.reserve) unsure = true;
  }
  if (!reachesCarry) return null;
  return { hours: ((opts.end ?? span.end) - from) / HOUR, unsure };
}

/**
 * CBA 2026 12.C.1.b / 12.D.1.i: "relieved from all duty for at least 24 consecutive hours at least once during any seven
 * consecutive days". CBA 2026 12.C.1.c: 1-in-10 is the same over 240 hours, at base, for "exclusively" domestic trips, and
 * waivable on the bid. Every bid period.
 *
 * "Any seven consecutive days" can be measured two ways: 144 hours with no break (a full 7 days holds no 24 hours off), or
 * 120 (a window that starts just under 24 hours into a break). Past the longer it's certain; between them it's a question
 * for the ex-pilot (question 21). Which trip gets dropped is also unsettled, so it's the first one to break the rule
 * (question 2).
 */
function findLegalityConflicts(trip: Trip, span: Span, blocks: Block[], elections: PhaseInElections): PhaseInFinding[] {
  const out: PhaseInFinding[] = [];
  const name = (hours: number) => `${Math.round(hours / 24)} days`;
  // A 24-hour layover inside the trip is the relief, so the stretch ends where it starts.
  const duties = tripSpans(trip, span.start);
  const firstRelief = duties.findIndex((d, i) => i + 1 < duties.length && duties[i + 1].start - d.end >= RELIEF_HOURS * HOUR);
  const seven = stretchFromCarryIn(span, blocks, { atBase: false, end: firstRelief >= 0 ? duties[firstRelief].end : span.end });
  if (seven && seven.hours > ONE_IN_7_HOURS - 2 * RELIEF_HOURS) {
    const beyond = seven.hours > ONE_IN_7_HOURS - RELIEF_HOURS;
    out.push({
      tripId: trip.id,
      pairingNumber: trip.pairingNumber,
      rule: "one-in-7",
      section: "CBA 2026 12.C.1.b, 12.D.1.i, 25.F.1.b",
      detail: `would run ${name(seven.hours)} from your carry-in without 24 hours off${seven.unsure ? ", unless your carry-in has a layover that long" : ""}`,
      certainty: beyond && !seven.unsure ? "clear" : "check",
      waivedBy: null,
      waived: false,
    });
  }
  if (!flownUnderInternationalRules(trip)) {
    const ten = stretchFromCarryIn(span, blocks, { atBase: true });
    if (ten && ten.hours > ONE_IN_10_HOURS - 2 * RELIEF_HOURS) {
      const beyond = ten.hours > ONE_IN_10_HOURS - RELIEF_HOURS;
      out.push({
        tripId: trip.id,
        pairingNumber: trip.pairingNumber,
        rule: "one-in-10",
        section: "CBA 2026 12.C.1.c, 25.E.1.d",
        detail: `would run ${name(ten.hours)} from your carry-in without 24 hours off at base`,
        certainty: beyond && !ten.unsure ? "clear" : "check",
        waivedBy: "1-in-10",
        waived: elections.waive1in10,
      });
    }
  }
  return out;
}

/** The bid month's day indices a stretch of time touches, in local base days (CBA 2026 25.A.5: days off are local base days; 25.A.2: when one starts). */
export function dayIndices(span: Span, pack: Pick<BidPack, "bidPeriodStart" | "bidPeriodDays" | "base">): number[] {
  if (!pack.bidPeriodStart) return [];
  const zone = zoneOf(pack);
  const first = DateTime.fromISO(pack.bidPeriodStart, { zone }).startOf("day");
  const dayStart = baseDayStartMinutes(zone);
  const at = (ms: number) => Math.round(DateTime.fromMillis(ms, { zone }).minus({ minutes: dayStart }).startOf("day").diff(first, "days").days);
  const out: number[] = [];
  // A release at the stroke of midnight doesn't touch the new day.
  for (let d = at(span.start); d <= at(span.end - 1); d++) if (d >= 0 && d < pack.bidPeriodDays) out.push(d);
  return out;
}

const operatedHours = (trip: Trip) =>
  trip.schedule.flatMap((d) => d.legs).filter((l) => !l.isDeadhead && !l.isStandby).reduce((a, l) => a + (l.blockHours ?? 0), 0);

/** The days a dropped trip leaves free: nothing kept or carried in is on them. */
function freedDays(dropped: Trip[], kept: Trip[], pack: BidPack, spanOf: Map<Trip, Span>, carriedDays: Set<number>): Set<number> {
  const daysOf = (trips: Trip[]) => trips.flatMap((t) => (spanOf.has(t) ? dayIndices(spanOf.get(t)!, pack) : []));
  const keptDays = new Set(daysOf(kept));
  return new Set(daysOf(dropped).filter((d) => !keptDays.has(d) && !carriedDays.has(d)));
}

/**
 * The line with these trips gone and these days no longer free. Everything the line prints comes down by the dropped
 * trips' share of this month. Credit too, unless `creditPaid`: a trip a vacation removes is still paid, from the vacation
 * bank (CBA 2026 7.G.1). `alsoOff` adds days off beyond the trips' own: the vacation days themselves.
 */
export function lineAsFlown(line: Line, pack: BidPack, dropped: Trip[], spanOf: Map<Trip, Span>, carriedDays: Set<number>, opts: { creditPaid?: boolean; alsoOff?: Set<number> } = {}): Line {
  const gone = new Set(dropped);
  const kept = line.trips.filter((t) => !gone.has(t));
  const carryOver = lineCarryOver(line, pack);
  const freed = freedDays(dropped, kept, pack, spanOf, carriedDays);
  const keptDays = new Set(kept.flatMap((t) => (spanOf.has(t) ? dayIndices(spanOf.get(t)!, pack) : [])));
  const alsoFree = [...(opts.alsoOff ?? [])].filter((d) => !keptDays.has(d) && !carriedDays.has(d));
  const off = line.gridOffDays ? new Set([...line.gridOffDays.filter((d) => !carriedDays.has(d)), ...freed, ...alsoFree]) : null;
  // Without the grid: the carried-in days that took a day off are the ones no trip was on.
  const worked = new Set(line.trips.flatMap((t) => (spanOf.has(t) ? dayIndices(spanOf.get(t)!, pack) : [])));
  const printedOff = line.gridOffDays ? null : Math.max(0, line.daysOff + new Set([...freed, ...alsoFree.filter((d) => worked.has(d))]).size - [...carriedDays].filter((d) => !worked.has(d)).length);

  let credit = line.totalCreditHours;
  let tafb = line.totalTafbHours;
  let block = line.totalBlockHours;
  let carryCredit = line.carryOverCreditHours;
  let carryBlock = line.carryOverBlockHours;
  let landings = line.totalLandings;
  let duties = line.totalDutyPeriods;
  for (const t of dropped) {
    const carries = !!carryOver && carryOver.trips.includes(t.pairingNumber) && !!splitTrip(t, pack)?.carry;
    const inMonth = splitTrip(t, pack, carries ? (line.carryOverCreditHours ?? 0) : 0)?.inMonth ?? t;
    if (!opts.creditPaid) credit -= inMonth.creditHours;
    tafb -= inMonth.tafbHours;
    if (block !== undefined) block -= operatedHours(inMonth);
    if (carries) {
      if (!opts.creditPaid) carryCredit = carryCredit === undefined ? carryCredit : 0;
      carryBlock = carryBlock === undefined ? carryBlock : 0;
    }
    // The pack's own counts run across the carry-over (see `lib/bid-month.ts`).
    landings -= t.landings;
    if (duties !== undefined) duties -= tripDutyPeriods(t);
  }
  return {
    ...line,
    trips: kept,
    daysOff: off ? off.size : printedOff!,
    totalCreditHours: Math.max(0, Math.round(credit * 100) / 100),
    totalTafbHours: Math.max(0, tafb),
    ...(block !== undefined ? { totalBlockHours: Math.max(0, block) } : {}),
    ...(carryCredit !== undefined ? { carryOverCreditHours: carryCredit } : {}),
    ...(carryBlock !== undefined ? { carryOverBlockHours: carryBlock } : {}),
    totalLandings: Math.max(0, landings),
    totalDepartures: Math.max(0, landings),
    ...(duties !== undefined ? { totalDutyPeriods: Math.max(0, duties) } : {}),
    ...(off ? { gridOffDays: [...off].sort((a, b) => a - b) } : {}),
  };
}

/** CBA 2026 25.F.7: the fewest trips, least CH first, that bring the line back to its minimum days off. */
function minDaysOptions(flown: Line, pack: BidPack, needed: number, spanOf: Map<Trip, Span>, carriedDays: Set<number>): MinDaysOption[] {
  const trips = flown.trips.filter((t) => spanOf.has(t));
  const groups: Trip[][] = [...trips.map((t) => [t]), ...trips.flatMap((a, i) => trips.slice(i + 1).map((b) => [a, b]))];
  const options = groups.flatMap((group): MinDaysOption[] => {
    const after = flown.daysOff + freedDays(group, trips.filter((t) => !group.includes(t)), pack, spanOf, carriedDays).size;
    if (after < needed) return [];
    return [
      {
        pairingNumbers: group.map((t) => t.pairingNumber),
        daysOffAfter: after,
        makeUpCH: group.reduce((a, t) => a + t.creditHours, 0),
        section: after === needed ? "25.F.7.a" : "25.F.7.b",
      },
    ];
  });
  // Only pairs when no single trip does it.
  const fewest = Math.min(...options.map((o) => o.pairingNumbers.length));
  return options
    .filter((o) => o.pairingNumbers.length === fewest)
    .sort((a, b) => (a.section === b.section ? a.makeUpCH - b.makeUpCH : a.section === "25.F.7.a" ? -1 : 1))
    .slice(0, 3);
}

function reasonFor(f: Omit<FlownLine, "reason" | "line">): string | null {
  const parts: string[] = [];
  if (f.dropped.length) {
    const names = f.dropped.map((d) => `${tripName(d.trip)} (${d.makeUpCH.toFixed(1)} CH)`).join(" and ");
    parts.push(`Your carry-in drops ${names}, without pay but make-up eligible`);
    const gained = (f.longestOffAfter ?? 0) - (f.longestOffBefore ?? 0);
    if (f.daysOffAfter > f.daysOffBefore) parts.push(`${f.daysOffAfter - f.daysOffBefore} more day${f.daysOffAfter - f.daysOffBefore === 1 ? "" : "s"} off${gained > 0 ? `, ${f.longestOffAfter} in a row` : ""}`);
  } else if (f.daysOffAfter < f.daysOffBefore) {
    parts.push(`Your carry-in takes ${f.daysOffBefore - f.daysOffAfter} of its days off`);
  }
  const waived = f.kept.filter((k) => k.waived);
  if (waived.length) parts.push(`you keep ${waived.map((w) => tripName({ pairingNumber: w.pairingNumber })).join(" and ")} because you waived the ${waived[0].waivedBy === "1-in-10" ? "1-in-10" : "international buffer"}`);
  const checks = f.kept.filter((k) => !k.waived);
  if (checks.length) parts.push(`check ${tripName({ pairingNumber: checks[0].pairingNumber })}: it ${checks[0].detail}`);
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** The bid month's days a carry-in is still flying or on reserve. */
export function carriedDaysOf(pack: Pick<BidPack, "base" | "bidPeriodStart" | "bidPeriodDays">, carryIn: CarryInItem[]): Set<number> {
  const zone = zoneOf(pack);
  return new Set(
    carryIn.flatMap((c) => {
      const b = carryBlock(c, zone);
      return b ? dayIndices({ start: b.duties[0].start, end: b.duties[b.duties.length - 1].end }, pack) : [];
    })
  );
}

/** One line of the new month with the carry-in laid over it. */
export function flyLine(line: Line, pack: BidPack, carryIn: CarryInItem[], elections: PhaseInElections): FlownLine {
  const rules = phaseInRules(pack.month);
  const zone = zoneOf(pack);
  const carryBlocks = carryIn.flatMap((c) => {
    const b = carryBlock(c, zone);
    return b ? [b] : [];
  });
  const carriedDays = carriedDaysOf(pack, carryIn);
  const longestBefore = longestDaysOffBlock(line);
  const blank = { dropped: [], kept: [], makeUpCH: 0, daysOffBefore: line.daysOff, daysOffAfter: line.daysOff, longestOffBefore: longestBefore, longestOffAfter: longestBefore, minDays: null, advice: [] };

  const placed = line.trips.map((t) => ({ trip: t, report: tripReportUtc(pack, t) }));
  if (!carryBlocks.length) return { line, unchecked: false, ...blank, reason: null };
  if (line.estimated || placed.some((p) => p.report === null)) return { line, unchecked: true, ...blank, reason: null };

  const spanOf = new Map<Trip, Span>();
  for (const p of placed) spanOf.set(p.trip, { start: p.report!, end: p.report! + p.trip.tafbHours * HOUR });
  const ordered = [...placed].sort((a, b) => a.report! - b.report!);

  const dropped: DroppedTrip[] = [];
  const kept: PhaseInFinding[] = [];
  const advice: string[] = [];
  const blocks: Block[] = [...carryBlocks];
  for (const { trip } of ordered) {
    const span = spanOf.get(trip)!;
    const findings = [...findCarryConflicts(trip, span, blocks, rules, elections), ...findLegalityConflicts(trip, span, blocks, elections)];
    const drops = findings.filter((f) => f.certainty === "clear" && !f.waived);
    if (!drops.length) kept.push(...findings);
    if (drops.length) {
      // CBA 2026 25.F.5: "the trip(s) in the new bid period shall be dropped without pay and the pilot shall be eligible to
      // make-up the CH value". Every bid period. A dropped trip isn't flown, so it can't be in the way of the next one.
      dropped.push({ trip, makeUpCH: trip.creditHours, findings: drops });
      // CBA 2026 25.F.3.a and 25.E.2.f: the pilot may ask to keep the long trip instead, every bid period.
      if (trip.tafbHours > DROP_NEW_TRIP_OVER_TAFB && drops.some((d) => d.rule !== "one-in-7" && d.rule !== "one-in-10")) {
        const short = carryIn.find((c) => (c.kind === "trip" ? (Date.parse(c.release) - Date.parse(c.report)) / HOUR < DROP_CARRYOVER_UNDER_TAFB : c.days < DROP_CARRYOVER_UNDER_RDAYS));
        if (short) advice.push(`${tripName(trip)} is over 120 hours TAFB, so you can submit to drop ${short.label} instead during the Conflict Input Window, processed in seniority order (CBA 2026 25.F.3.a, 25.E.2.f).`);
      }
      continue;
    }
    blocks.push({ duties: tripSpans(trip, span.start), international: flownUnderInternationalRules(trip), dutiesKnown: trip.schedule.length > 0, carry: null });
  }

  const droppedTrips = dropped.map((d) => d.trip);
  const flown = lineAsFlown(line, pack, droppedTrips, spanOf, carriedDays);
  const needed = minimumDaysOff(pack.bidPeriodDays);
  const short = needed !== null && flown.daysOff < needed;
  const minDays = short ? { needed: needed!, have: flown.daysOff, options: minDaysOptions(flown, pack, needed!, spanOf, carriedDays) } : null;
  if (minDays) {
    const best = minDays.options[0];
    const how = best ? ` ${best.pairingNumbers.map((n) => tripName({ pairingNumber: n })).join(" and ")} would bring it back (CBA 2026 ${best.section}).` : "";
    advice.push(`This leaves ${minDays.have} days off; the minimum looks to be ${minDays.needed}. With minimum days off protection you can drop a trip and make it up.${how}`);
  }

  const base = {
    unchecked: false,
    dropped,
    kept,
    makeUpCH: dropped.reduce((a, d) => a + d.makeUpCH, 0),
    daysOffBefore: line.daysOff,
    daysOffAfter: flown.daysOff,
    longestOffBefore: longestBefore,
    longestOffAfter: longestDaysOffBlock(flown),
    minDays,
    advice,
  };
  return { ...base, line: flown, reason: reasonFor(base) };
}

/** The whole pack as it will fly, ready to score, and what happened to each line (by line id). */
export function flyPack(pack: BidPack, carryIn: CarryInItem[], elections: PhaseInElections): { pack: BidPack; lines: Map<string, FlownLine> } {
  const lines = new Map<string, FlownLine>();
  if (!carryIn.length) return { pack, lines };
  for (const line of pack.lines) lines.set(line.id, flyLine(line, pack, carryIn, elections));
  return { pack: { ...pack, lines: pack.lines.map((l) => lines.get(l.id)!.line) }, lines };
}

/** A ranking made from the flown pack, with each line back as the pack prints it: it's what the list draws. */
export function withPrintedLines<T extends { line: Line }>(scored: T[], pack: BidPack, flown: BidPack): T[] {
  if (pack === flown) return scored;
  const printed = new Map(pack.lines.map((l) => [l.id, l]));
  return scored.map((s) => ({ ...s, line: printed.get(s.line.id) ?? s.line }));
}

export interface VipsRecommendation {
  key: keyof VipsBidAnswers;
  /** Null when it's the pilot's call: we can't see what it turns on. */
  answer: boolean | null;
  reason: string;
  /** The contract section behind the question. */
  section: string;
}

/** How many of the pilot's lines the waiver advice looks at. */
const RECOMMEND_TOP_LINES = 20;

/**
 * The four answers on the monthly bid, each with its reason, from what they do to the top of this pilot's order. Pure:
 * step 2's Send to VIPS dialog shows them, and the pilot still answers.
 *
 * Each waiver is compared by scoring the pack both ways with the pilot's own model, top lines counting most: a waiver
 * keeps a trip and its pay, but gives up days off and the choice of a make-up trip. Without a model there's nothing to
 * weigh them with, so that's the pilot's call.
 */
export function recommendVipsAnswers(input: { pack: BidPack; order: string[]; carryIn: CarryInItem[]; model?: PilotModel | null }): VipsRecommendation[] {
  const { pack, order, carryIn, model } = input;
  const top = order.slice(0, RECOMMEND_TOP_LINES);
  const recurrent: VipsRecommendation = {
    key: "waiveBufferRecurrent",
    answer: null,
    reason: "This turns on your recurrent training, which we can't see.",
    section: "CBA 2026 25.E.1.c",
  };
  const off = flyPack(pack, carryIn, NO_ELECTIONS);

  const compare = (key: "waiveBufferPhaseIn" | "waive1in10", section: string, waiverName: string): VipsRecommendation => {
    if (!carryIn.length) return { key, answer: false, reason: `No carry-in entered, so there's no phase-in conflict for a ${waiverName} waiver to avoid.`, section };
    const on = flyPack(pack, carryIn, { ...NO_ELECTIONS, [key]: true });
    const byNumber = new Map(pack.lines.map((l) => [l.lineNumber, l.id]));
    const changes = top.filter((n) => {
      const id = byNumber.get(n);
      return !!id && on.lines.get(id)!.dropped.length !== off.lines.get(id)!.dropped.length;
    });
    if (!changes.length) return { key, answer: false, reason: `None of your top ${top.length} lines has a conflict this would avoid.`, section };
    if (!model) return { key, answer: null, reason: `It would keep a trip on ${changes.length} of your top ${top.length} lines. We need your priorities to weigh that against the days off.`, section };
    const scores = (p: BidPack) => new Map(scorePackV2(p, model).map((s) => [s.lineNumber, s.score]));
    const withIt = scores(on.pack);
    const without = scores(off.pack);
    const lean = top.reduce((sum, n, i) => sum + ((withIt.get(n) ?? 0) - (without.get(n) ?? 0)) / (i + 1), 0);
    return lean > 0
      ? { key, answer: true, reason: `It keeps a trip on ${changes.length} of your top ${top.length} lines, and your priorities score those lines higher with the trip.`, section }
      : { key, answer: false, reason: `It would keep a trip on ${changes.length} of your top ${top.length} lines, but your priorities score them higher without it (more days off, and you pick the make-up).`, section };
  };

  const protect = (): VipsRecommendation => {
    const section = "CBA 2026 25.E.1.a, 25.F.7";
    const short = top.filter((n) => {
      const line = pack.lines.find((l) => l.lineNumber === n);
      return !!line && !!off.lines.get(line.id)?.minDays;
    });
    if (short.length)
      return { key: "protectMinDays", answer: true, reason: `Your carry-in leaves ${short.length} of your top ${top.length} lines under the minimum days off; this lets you drop a trip and make it up.`, section };
    const carried = carryIn.length ? `Your carry-in doesn't put your top ${top.length} lines under the minimum, but this` : "This";
    return { key: "protectMinDays", answer: null, reason: `${carried} also covers recurrent training, which we can't see.`, section };
  };

  return [
    recurrent,
    compare("waiveBufferPhaseIn", "CBA 2026 25.E.1.c, 25.F.4, 12.D.1.d.iii", "buffer"),
    compare("waive1in10", "CBA 2026 25.E.1.d, 12.C.1.c", "1-in-10"),
    protect(),
  ];
}
