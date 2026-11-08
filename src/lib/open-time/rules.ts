import { DateTime } from "luxon";
import { bidMonthOfPack } from "@/lib/contract/pack-facts";
import { baseDayStartMinutes, phaseInRules, rDayConflictsWithEarlier, rDayConflictsWithLater, reservePeriodSpan, type ReservePeriod, type Span } from "@/lib/phase-in";

/**
 * The contract's rules for taking a trip from open time, each quoting its section and saying which bid periods it covers.
 * The 2015 wording holds until a change's phase starts (Implementation LOA): Phase 2 is the December 2026 bid period,
 * Phase 3 August 2027, Phase 4 October 2027. Pure: no pack, no pilot, just the numbers a rule needs, so every rule can be
 * tested on its own (`rules.test.ts` checks each quote below against the contract's text).
 *
 * Duties, rest, 1-in-7 and vacations are checked by `fitCheck` in `view-add.ts`, under CBA 2026 25.L.1.d. Where the text
 * doesn't settle a case the finding is level "check": the pilot's told, nothing's ruled out, and the question is in
 * private/ex-pilot/open-time-questions.md.
 */

const HOUR = 3_600_000;
const FLOAT_SLACK = 1e-9;

/** "no": rules it out. "late": past a deadline, the Company's call. "check": the text or our data doesn't settle it. "note": worth knowing. */
export type RuleLevel = "no" | "late" | "check" | "note";

export interface RuleFinding {
  /** "25.L.1.b" */
  section: string;
  level: RuleLevel;
  text: string;
}

/** The make-up and priority banks a pilot can pick up against. */
export type BankCode = "PMU" | "PNP" | "CMU" | "SMU" | "M/U" | "MUS" | "MUV" | "AFB";
export type Banks = Partial<Record<BankCode, number>>;

/** How a trip got on the pilot's line: "LINE" is what they were awarded. The rest are the codes CBA 2026 25.L.1.h names. */
export type AssignedAs = "LINE" | "VLT" | "DRF" | "AVA" | "CMU" | "PDO" | "PMU" | "RSV";

const PHASE_2 = "2026-12";
const PHASE_3 = "2027-08";
const PHASE_4 = "2027-10";

export interface OpenTimeRules {
  /** CBA 2026 25.L.4.d, 25.L.5.c, 25.L.6.e: how far past a bank a trip can go. 7 CH from December 2026; 6 CH before it. */
  overageCH: number;
  /** CBA 2026 25.L.8.a: the most trades can raise a line's BLG. 13 CH from December 2026; 12 CH before it. */
  tradeNetCH: number;
  /** CBA 2026 25.L.1.h: PMU joins from December 2026. */
  lockedCodes: AssignedAs[];
  /** CBA 2026 25.L.1.a: real-time trip trading, from August 2027. */
  realTime: boolean;
  /** CBA 2026 25.L.6.b.vii, and 25.G.3.b.i–iv for what goes ahead of it: SMU joins from October 2027. */
  bankOrder: BankCode[];
}

export function openTimeRules(packMonth: string): OpenTimeRules {
  const month = bidMonthOfPack(packMonth) ?? "";
  const phase2 = month >= PHASE_2;
  return {
    overageCH: phaseInRules(packMonth).makeUpOverageCH,
    tradeNetCH: phase2 ? 13 : 12,
    lockedCodes: ["VLT", "DRF", "AVA", "CMU", "PDO", ...(phase2 ? (["PMU"] as const) : []), "RSV"],
    realTime: month >= PHASE_3,
    bankOrder: ["PMU", "PNP", "CMU", ...(month >= PHASE_4 ? (["SMU"] as const) : []), "M/U", "MUS", "MUV", "AFB"],
  };
}

/** The first moment of the base day a time falls in. CBA 2026 25.A.2: a local base day starts at 0130 LBT, 0215 LBT at EUR. */
function baseDayOf(at: number, zone: string): DateTime {
  return DateTime.fromMillis(at, { zone }).minus({ minutes: baseDayStartMinutes(zone) }).startOf("day");
}

const clock = (at: number, zone: string) => DateTime.fromMillis(at, { zone }).toFormat("LLL d, HHmm 'LBT'");

/**
 * CBA 2026 25.L.1.b, every bid period: "Submissions for open time trips (e.g., PMU, make-up or trip trade), and submissions
 * to drop a trip shall be submitted no later than 0900 LBT on the day before the first affected activity."
 * The day before is counted in base days (25.A.2), so a 0030 show belongs to the day before its calendar date.
 */
export function submissionDeadline(firstActivity: number, zone: string): number {
  return baseDayOf(firstActivity, zone).minus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toMillis();
}

/** CBA 2026 25.L.1.b, every bid period: "When submitted later than 0900 LBT on the applicable day, such submission may be processed at the Company's discretion." */
export function checkDeadline(firstActivity: number, now: number, zone: string): RuleFinding[] {
  if (firstActivity <= now) return [{ section: "25.L.1.b", level: "no", text: "It has already started." }];
  const deadline = submissionDeadline(firstActivity, zone);
  if (now > deadline) return [{ section: "25.L.1.b", level: "late", text: `The deadline was ${clock(deadline, zone)}. It's up to the Company now (CBA 2026 25.L.1.b).` }];
  return [{ section: "25.L.1.b", level: "note", text: `Submit by ${clock(deadline, zone)} (CBA 2026 25.L.1.b).` }];
}

/**
 * CBA 2026 25.L.4.b, 25.L.5.a, every bid period: "This priority is guaranteed only for PMU submissions made prior to 0900
 * LBT, at least 48 hours prior to the showtime of the identified trip." PNP's reads the same. The last 0900 LBT that's
 * still 48 hours ahead.
 */
export function priorityGuaranteedUntil(show: number, zone: string): number {
  const latest = DateTime.fromMillis(show - 48 * HOUR, { zone });
  const nine = latest.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
  return (nine <= latest ? nine : nine.minus({ days: 1 })).toMillis();
}

/**
 * CBA 2026 25.L.1.h: "A pilot may not trade, proffer, or drop a trip assigned as VLT, DRF, AVA, CMU, PDO, PMU, or RSV."
 * PMU from December 2026 (Implementation LOA, Phase 2); the others every bid period.
 */
export function checkAssignedAs(code: AssignedAs, rules: OpenTimeRules): RuleFinding[] {
  if (!rules.lockedCodes.includes(code)) return [];
  return [{ section: "25.L.1.h", level: "no", text: `A trip assigned as ${code} can't be traded, proffered or dropped (CBA 2026 25.L.1.h).` }];
}

function noDropDaysOf(year: number): { name: string; month: number; day: number }[] {
  const november = DateTime.utc(year, 11, 1);
  const thanksgiving = 1 + ((4 - november.weekday + 7) % 7) + 21;
  return [
    { name: "New Year's Day", month: 1, day: 1 },
    { name: "Thanksgiving Day", month: 11, day: thanksgiving },
    { name: "Christmas Eve", month: 12, day: 24 },
    { name: "Christmas Day", month: 12, day: 25 },
    { name: "New Year's Eve", month: 12, day: 31 },
  ];
}

/**
 * CBA 2026 25.L.3.b, every bid period: "A pilot may not drop a trip or R-day that is scheduled in whole or in part on the
 * following days (i.e. base days): New Year's Eve, New Year's Day, Thanksgiving Day, Christmas Eve or Christmas Day."
 * The first such day a span touches, each as a base day (25.A.2): at 0030 LBT on Christmas Eve it's still the 23rd's.
 */
export function noDropDayIn(span: Span, zone: string): string | null {
  const first = DateTime.fromMillis(span.start, { zone }).year;
  const last = DateTime.fromMillis(span.end, { zone }).year;
  const startMinutes = baseDayStartMinutes(zone);
  for (let year = first - 1; year <= last; year++) {
    for (const d of noDropDaysOf(year)) {
      const opens = DateTime.fromObject({ year, month: d.month, day: d.day }, { zone }).plus({ minutes: startMinutes });
      if (span.start < opens.plus({ days: 1 }).toMillis() && span.end > opens.toMillis()) return d.name;
    }
  }
  return null;
}

/** CBA 2026 25.L.3.b as a finding, for a drop. */
export function checkDrop(span: Span, zone: string): RuleFinding[] {
  const day = noDropDayIn(span, zone);
  return day ? [{ section: "25.L.3.b", level: "no", text: `The trip you'd drop is scheduled on ${day}, so it can't be dropped (CBA 2026 25.L.3.b).` }] : [];
}

export interface BankOption {
  code: BankCode;
  hours: number;
  eligible: boolean;
  /** The section setting its limit. */
  section: string;
  /** Why not, or what comes with it. */
  notes: string[];
}

/**
 * Which banks can take a trip, in the order they're processed. One bank at a time: CBA 2026 25.L.6.d, every bid period: "A
 * make-up assignment shall be operated under a single pay code (e.g., one trip could not be half MUV and half MUS)."
 *
 * The limits, 7 CH from December 2026 and 6 CH before it (Implementation LOA, Phase 2):
 * CBA 2026 25.L.4.d: "The pilot is not eligible for a PMU assignment that exceeds the pilot's OTP eligibility by more than 7 CH."
 * CBA 2026 25.L.5.c: "The pilot is not eligible for a PNP assignment that exceeds the pilot's PNP eligibility by more than 7 CH."
 * CBA 2026 25.L.6.e: "A pilot is not eligible for a make-up assignment that exceeds the pilot's make-up eligibility by more than 7 CH."
 * CBA 2026 25.L.7, every bid period: "Submissions for AFB shall be administered as provided in Section 25.L.6."
 *
 * The order, CBA 2026 25.L.6.b.vii: "Submissions for make-up shall be processed in the following order: CMU, SMU, M/U, MUS,
 * MUV and AFB." SMU from October 2027 (Phase 4). PMU and PNP go first: 25.L.4.b, 25.L.5.a, every bid period, except as
 * 25.L.1.a provides from August 2027.
 */
export function banksFor(creditHours: number, banks: Banks, rules: OpenTimeRules): BankOption[] {
  return rules.bankOrder.flatMap((code) => {
    const hours = banks[code];
    if (!hours || hours <= 0) return [];
    const section = code === "PMU" ? "25.L.4.d" : code === "PNP" ? "25.L.5.c" : code === "AFB" ? "25.L.7" : "25.L.6.e";
    const past = creditHours - hours;
    const eligible = past <= rules.overageCH + FLOAT_SLACK;
    const notes: string[] = [];
    if (!eligible) notes.push(`${creditHours.toFixed(1)} CH passes your ${hours.toFixed(1)} CH of ${code} by more than ${rules.overageCH} CH (CBA 2026 ${section}).`);
    // CBA 2026 25.L.4.b, every bid period: "The pilot may submit for a specific trip(s) from available open time, but not for a trip which the pilot rejected as a substitution assignment."
    if (code === "PMU") notes.push("Not a trip you rejected as a substitution (CBA 2026 25.L.4.b).");
    if (rules.lockedCodes.includes(code as AssignedAs)) notes.push(`Once assigned as ${code} it can't be traded, proffered or dropped (CBA 2026 25.L.1.h).`);
    // CBA 2026 25.L.5.d, every bid period: "If a PNP trip is dropped as provided in Section 25.L.3.a., those CH revert to general make up (M/U)."
    if (code === "PNP") notes.push("If you drop it, those CH go back to general make-up (CBA 2026 25.L.5.d).");
    // CBA 2026 25.L.6.f, from October 2027 (Phase 4): "If a SMU trip is dropped as provided in Section 25.L.3.a., those CH revert to general make up (M/U)."
    if (code === "SMU") notes.push("If you drop it, those CH go back to general make-up (CBA 2026 25.L.6.f).");
    return [{ code, hours, eligible, section, notes }];
  });
}

/** Whether the priority on a PMU or PNP bank is still guaranteed for this trip, as a finding. See `priorityGuaranteedUntil`. */
export function checkPriority(code: "PMU" | "PNP", show: number, now: number, zone: string): RuleFinding {
  const section = code === "PMU" ? "25.L.4.b" : "25.L.5.a";
  const until = priorityGuaranteedUntil(show, zone);
  return now < until
    ? { section, level: "note", text: `${code} priority is guaranteed if you submit before ${clock(until, zone)} (CBA 2026 ${section}).` }
    : { section, level: "check", text: `It's inside 48 hours or past the 0900 LBT cut-off, so ${code} priority isn't guaranteed (CBA 2026 ${section}).` };
}

/**
 * CBA 2026 25.L.8.a: "The net effect of any trade(s) in a bid period (including similar footprint trades, as described in
 * Section 25.L.8.b.) may not increase the pilot's BLG, as published, by more than 13 CH." 12 CH before December 2026
 * (Implementation LOA, Phase 2). `tradedSoFarCH` is what this bid period's trades have already added.
 */
export function checkTradeLimit(openCH: number, givenUpCH: number, tradedSoFarCH: number, rules: OpenTimeRules): RuleFinding[] {
  const net = tradedSoFarCH + openCH - givenUpCH;
  if (net > rules.tradeNetCH + FLOAT_SLACK) return [{ section: "25.L.8.a", level: "no", text: `This trade would put you ${net.toFixed(1)} CH over your published BLG; the limit is ${rules.tradeNetCH} CH (CBA 2026 25.L.8.a).` }];
  return [{ section: "25.L.8.a", level: "note", text: `Net of trades: ${net >= 0 ? "+" : ""}${net.toFixed(1)} CH against a limit of ${rules.tradeNetCH} CH (CBA 2026 25.L.8.a).` }];
}

export interface TripTimes {
  show: number;
  tafbHours: number;
}

/** The reserve periods a show falls in, on its base day and running over from the one before. CBA 2026 25.M.2.a.i–iv, every bid period. */
function reservePeriodsAt(at: number, zone: string): Set<ReservePeriod> {
  const day = baseDayOf(at, zone);
  const out = new Set<ReservePeriod>();
  const inside = (d: DateTime, rp: ReservePeriod) => {
    const s = reservePeriodSpan(d.toISODate()!, rp, zone);
    return at >= s.start && at < s.end;
  };
  for (const rp of ["A", "A+", "B", "B+"] as const) if (inside(day, rp) || inside(day.minus({ days: 1 }), rp)) out.add(rp);
  return out;
}

/**
 * CBA 2026 25.L.8.b.i, ii, every bid period: a trade that staffing would otherwise stop "shall be accepted if: i. The trade
 * is submitted no later than 72 hours before the showtime of the trip(s) being placed into open time; and ii. The trip(s) in
 * open time has a showtime: (a) On the same local base day; and (b) In the same reserve period as the original trip(s); and
 * (c) An equal to or greater TAFB than the original trip(s)".
 *
 * Reserve periods overlap, so a 0900 show is in both RP-A and RP-A+. We read "the same" as sharing one (a question for the
 * ex-pilot). Trades of a series of trips (25.L.8.b.iii) aren't handled: this looks at one trip for one trip.
 */
export function isSimilarFootprint(open: TripTimes, given: TripTimes, now: number, zone: string): boolean {
  if (given.show - now < 72 * HOUR) return false;
  if (!baseDayOf(open.show, zone).equals(baseDayOf(given.show, zone))) return false;
  if (open.tafbHours + FLOAT_SLACK < given.tafbHours) return false;
  const original = reservePeriodsAt(given.show, zone);
  return [...reservePeriodsAt(open.show, zone)].some((rp) => original.has(rp));
}

/**
 * The trade's staffing risk. CBA 2026 25.L.2.a, every bid period: "The Company may deny a pilot's submission for a bid line
 * adjustment that would place a trip(s) into open time in excess of the Max Open." We can't see Max Open; a similar
 * footprint is safe from it (see `isSimilarFootprint`).
 */
export function checkStaffing(similar: boolean): RuleFinding {
  return similar
    ? { section: "25.L.8.b", level: "note", text: "A similar-footprint trade: staffing can't stop it (CBA 2026 25.L.8.b)." }
    : { section: "25.L.2.a", level: "check", text: "The Company can deny a trade that puts too many trips in open time, and we can't see that number (CBA 2026 25.L.2.a)." };
}

/**
 * CBA 2026 25.L.1.d.i, ii, every bid period: "An R-day conflicts with an earlier assignment unless there are at least 12
 * hours prior to the start of the pilot's first RP" and "An R-day conflicts with a subsequent assignment unless there are at
 * least 12 hours between the end of the pilot's R-day and the beginning of the scheduled assignment".
 */
export function checkRDays(trip: Span, rDays: Span, label: string): RuleFinding[] {
  const overlaps = trip.start < rDays.end && trip.end > rDays.start;
  const clash = overlaps || (trip.end <= rDays.start ? rDayConflictsWithEarlier(trip.end, rDays.start) : rDayConflictsWithLater(rDays.end, trip.start));
  return clash ? [{ section: "25.L.1.d", level: "no", text: `It needs 12 hours clear of ${label} (CBA 2026 25.L.1.d).` }] : [];
}

/**
 * CBA 2026 25.L.3.d, every bid period: a contingency drop, where "the pilot specifies a trip(s) or R-day(s) to drop only if
 * the pilot is able to pick up a specific trip(s). The pilot must have the applicable bank CHs sufficient to cover the
 * trip(s) the pilot submits to pick up." Whether the hours the drop frees (25.L.3.c) can be that bank isn't settled by the
 * text, so a bank that can't cover it without them is only flagged.
 */
export function checkContingency(openCH: number, options: BankOption[]): RuleFinding[] {
  const covers = options.some((o) => o.hours + FLOAT_SLACK >= openCH);
  if (covers) return [{ section: "25.L.3.d", level: "note", text: "Set it up as a contingency: the drop only happens if you get this trip (CBA 2026 25.L.3.d)." }];
  return [{ section: "25.L.3.d", level: "check", text: `A contingency needs bank CH to cover ${openCH.toFixed(1)} CH. The text doesn't say whether the hours this drop frees count (CBA 2026 25.L.3.d).` }];
}

const MINUTES_0700 = 7 * 60;
const MINUTES_0800 = 8 * 60;
const HOLD_MS = 5 * 60_000;
const FIRST_HOURS_MS = 12 * HOUR;

export interface RealTimeTiming {
  /** "hold": bids wait out the 5 minutes. "immediate": processed as they come. */
  mode: "hold" | "immediate";
  /** When the hold on this trip ends, if we know when it appeared. Epoch ms. */
  holdEndsAt: number | null;
}

/**
 * CBA 2026 25.L.1.a.i, from August 2027 (Phase 3): "For the first 12 hours after the publication of open time, and from 0700
 * LBT through 0800 LBT each day: A trip or standby that appears in open time shall remain in open time for 5 minutes, at
 * which time all bid line adjustment submissions for that trip or standby shall be automatically and immediately processed
 * ... unless a bid line adjustment is submitted using PMU, in which case it shall be automatically and immediately processed."
 * CBA 2026 25.L.1.a.ii: "For any time period not covered by Section 25.L.1.a.i. above, a bid line adjustment submission shall
 * be automatically and immediately processed, regardless of status."
 * Null before August 2027, when there's no real-time trading to time.
 */
export function realTimeTiming(now: number, zone: string, rules: OpenTimeRules, opts: { publishedAt?: number | null; appearedAt?: number; usingPMU?: boolean } = {}): RealTimeTiming | null {
  if (!rules.realTime) return null;
  const local = DateTime.fromMillis(now, { zone });
  const minutes = local.hour * 60 + local.minute;
  const inFirstHours = !!opts.publishedAt && now >= opts.publishedAt && now < opts.publishedAt + FIRST_HOURS_MS;
  const inMorning = minutes >= MINUTES_0700 && minutes <= MINUTES_0800;
  if (opts.usingPMU || (!inFirstHours && !inMorning)) return { mode: "immediate", holdEndsAt: null };
  const ends = opts.appearedAt !== undefined ? opts.appearedAt + HOLD_MS : null;
  // Its five minutes are up: a bid now is processed as it comes.
  if (ends !== null && ends <= now) return { mode: "immediate", holdEndsAt: null };
  return { mode: "hold", holdEndsAt: ends };
}

export function checkRealTime(timing: RealTimeTiming | null, zone: string): RuleFinding[] {
  if (!timing) return [];
  if (timing.mode === "immediate") return [{ section: "25.L.1.a.ii", level: "note", text: "Bids are processed as they come in right now (CBA 2026 25.L.1.a.ii)." }];
  const when = timing.holdEndsAt ? `, until ${DateTime.fromMillis(timing.holdEndsAt, { zone }).toFormat("HH:mm:ss 'LBT'")}` : "";
  return [{ section: "25.L.1.a.i", level: "note", text: `Five-minute hold${when}: bids wait, then go in order. PMU goes straight through (CBA 2026 25.L.1.a.i).` }];
}

/** CBA 2026 25.G.2.b.iii, every bid period: "When a trip is frozen, it will be visible, but displayed in a manner indicating that it is available only to CRS." */
export function checkFrozen(frozen: boolean | undefined): RuleFinding[] {
  return frozen ? [{ section: "25.G.2.b.iii", level: "no", text: "It's marked frozen, so only CRS can assign it (CBA 2026 25.G.2.b.iii)." }] : [];
}
