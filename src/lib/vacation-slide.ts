import { DateTime } from "luxon";
import { newCloseRuleApplies, packBidClose } from "@/lib/bid-calendar";
import { bidTimeline } from "@/lib/bid-timeline";
import { longestDaysOffBlock, weekendDaysOff } from "@/lib/days-off-pattern";
import { baseDayStartMinutes, dayIndices, dutyIsInternational, flownUnderInternationalRules, lineAsFlown, touchesOutside48, zoneOf, type Span } from "@/lib/phase-in";
import { prepareMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { dayTripsOf, tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * A regular-line holder's vacation against the lines of a bid month: which trips it takes off a line, what that draws
 * from the vacation bank, and which slide (CBA 2026 7.E.2) or expansion (7.E.3) does the most for this pilot. Regular
 * lines only: 7.G.2 and 7.G.3 charge secondary and reserve lines another way.
 *
 * We never submit a slide. It's entered in VIPS during the Conflict Input Window (CBA 2026 25.E.2.b).
 * Questions the text leaves open are in private/ex-pilot/step4-what-we-need-from-you.md.
 */

const HOUR = 3_600_000;

/** CBA 2026 7.E.2.a: "up to a maximum of 5 days in either direction". Every bid period. */
export const MAX_SLIDE_DAYS = 5;
/** CBA 2026 7.A.1: 6 CH for each day of vacation. Every bid period. */
export const CH_PER_VACATION_DAY = 6;
/** CBA 2026 7.E.3.b: "by more than 6 CH". The chart's Phase 2 change to 7 lists 7.G.5.a and 25.L, not this. Every bid period. */
const EXPANSION_OVER_CH = 6;
/** CBA 2026 7.E.2.c: every bid period. */
const AFTER_INTERNATIONAL_HOURS = 48;
/** CBA 2026 12.D.1.d. */
const BUFFER_TAFB_HOURS = 120;
const BUFFER_BEFORE_HOURS = 24;
const BUFFER_AFTER_HOURS = 48;

/** CBA 2026 7.G.1: the front-end 24-hour buffer "may be waived" from the December 2026 bid period (Phase 2). Before it, "may not be waived". */
export function frontBufferWaivable(packMonth: string): boolean {
  return newCloseRuleApplies(packMonth);
}

/** The bid month in real instants, base day to base day. */
function periodSpan(pack: BidPack): Span | null {
  if (!pack.bidPeriodStart) return null;
  const zone = zoneOf(pack);
  const first = DateTime.fromISO(pack.bidPeriodStart, { zone }).plus({ minutes: baseDayStartMinutes(zone) });
  return { start: first.toMillis(), end: first.plus({ days: pack.bidPeriodDays }).toMillis() };
}

/** A vacation as real instants. The pack prints its last minute ("0129"); it ends when the next base day starts. */
export function vacationSpan(v: Pick<VacationPeriod, "from" | "to">): Span {
  return { start: Date.parse(v.from), end: Date.parse(v.to) + 60_000 };
}

/** The vacation moved by whole base days: the same clock time on the base's calendar, so a clock change doesn't shift it. */
function shifted(v: VacationPeriod, days: number, zone: string): Span {
  const whole = vacationSpan(v);
  const move = (ms: number) => DateTime.fromMillis(ms, { zone }).plus({ days }).toMillis();
  return { start: move(whole.start), end: move(whole.end) };
}

/** How far this bid month's trips reach: the last release of any line, past the month's end when a trip carries over. */
export function monthReachEnd(pack: BidPack): number | null {
  const period = periodSpan(pack);
  if (!period) return null;
  let end = period.end;
  for (const l of pack.lines) {
    for (const t of l.trips) {
      const report = tripReportUtc(pack, t);
      if (report !== null) end = Math.max(end, report + tripReleaseHours(t) * HOUR);
    }
  }
  return end;
}

export interface SlideCheck {
  /** Days moved: negative is earlier. */
  offset: number;
  span: Span;
  legal: boolean;
  /** Why not, naming the section. */
  why?: string;
  /**
   * Past this bid month, legal only to reach a trip of it that carries over: CBA 2026 7.E.2.b, "the Conflict Input Window in the
   * end of November ... is used to slide a January vacation to conflict with a December into January carryover trip".
   */
  carryoverOnly?: boolean;
}

/**
 * Every whole-day slide of a vacation, legal or not, for this bid month's Conflict Input Window.
 *
 * CBA 2026 7.E.2.a, every bid period: entered "during the Conflict Input Window immediately before the bid period in which
 * a trip(s) affected by the slide (or the vacation period itself, if no trip is affected) is scheduled to begin", "up to
 * a maximum of 5 days in either direction", and it "shall not reschedule any portion of that vacation into the preceding
 * bid periods of November or December". Example from the text: "A vacation in the first week of January may not be slid
 * back into December, but a vacation in the first week of February may be slid back into January."
 */
export function slideChecks(v: VacationPeriod, pack: BidPack): SlideCheck[] {
  const zone = zoneOf(pack);
  const period = periodSpan(pack);
  const reach = monthReachEnd(pack);
  const original = Date.parse(v.from);
  const name = pack.month.slice(0, 3).toUpperCase();
  const out: SlideCheck[] = [];
  for (let offset = -MAX_SLIDE_DAYS; offset <= MAX_SLIDE_DAYS; offset++) {
    const span = shifted(v, offset, zone);
    if (!period) {
      out.push({ offset, span, legal: false, why: "This pack doesn't give the bid month's dates." });
    } else if (offset === 0) {
      out.push({ offset, span, legal: true });
    } else if (span.start < period.start && offset < 0) {
      out.push({ offset, span, legal: false, why: "It starts before this bid month, so it needed last month's Conflict Input Window (CBA 2026 7.E.2.a)." });
    } else if (span.start >= period.end && span.start < reach!) {
      out.push({ offset, span, legal: true, carryoverOnly: true });
    } else if (span.start >= period.end || span.end <= period.start) {
      out.push({ offset, span, legal: false, why: "It doesn't touch this bid month, so this month's Conflict Input Window isn't the one for it (CBA 2026 7.E.2.a)." });
    } else if (original >= period.end && span.start < period.end && (name === "NOV" || name === "DEC")) {
      out.push({ offset, span, legal: false, why: `A slide can't move vacation back into the preceding November or December bid period (CBA 2026 7.E.2.a).` });
    } else {
      out.push({ offset, span, legal: true });
    }
  }
  return out;
}

export type RemovalRule = "overlap" | "after-international" | "buffer-after" | "buffer-before";

export interface RemovedTrip {
  trip: Trip;
  rule: RemovalRule;
  section: string;
  /** A front-end buffer from December 2026: the pilot could waive it to keep the trip (CBA 2026 7.G.1). */
  waivable: boolean;
}

function tripSpan(trip: Trip, pack: BidPack): Span | null {
  const report = tripReportUtc(pack, trip);
  return report === null ? null : { start: report, end: report + tripReleaseHours(trip) * HOUR };
}

/** CBA 2026 7.E.2.c: "a trip in which the last activity is an international duty period", except a trip under 12.D.1.c.i. */
function endsInternational(trip: Trip): boolean {
  const last = trip.schedule[trip.schedule.length - 1];
  return !!last && dutyIsInternational(trip, last);
}

/**
 * What a vacation takes off a line. CBA 2026 7.G.1: "A regular line holder shall be removed from a trip(s) in conflict with
 * the pilot's vacation period (as awarded or slid) or vacation expansion. Conflict with an international duty free
 * buffer, as described in Section 12.D.1.d., shall constitute a conflict with the trip protected by that buffer."
 * `slid`: CBA 2026 7.E.2.c's 48 hours apply "if a pilot slides", not to an expansion. Every bid period, but for the waiver
 * noted above and 12.D.1.d.i's domestic-parameters exception, Phase 2.
 */
export function vacationRemovals(line: Line, pack: BidPack, vacation: Span, opts: { slid: boolean; waiveFrontBuffer?: boolean }): RemovedTrip[] {
  const waivable = frontBufferWaivable(pack.month);
  const out: RemovedTrip[] = [];
  // Day by day for a run of day trips: 7.G.1 removes "trip(s) in conflict", and each day is its own trip, so a vacation
  // over one day of a run takes that day and charges its hours, not the run's.
  for (const trip of line.trips.flatMap(dayTripsOf)) {
    const span = tripSpan(trip, pack);
    if (!span) continue;
    const intl = flownUnderInternationalRules(trip);
    const long = intl && trip.tafbHours > BUFFER_TAFB_HOURS;
    const longBefore = (waivable ? intl : touchesOutside48(trip)) && trip.tafbHours > BUFFER_TAFB_HOURS;
    const sinceRelease = vacation.start - span.end;
    const untilReport = span.start - vacation.end;
    if (span.start < vacation.end && span.end > vacation.start) {
      out.push({ trip, rule: "overlap", section: "CBA 2026 7.G.1", waivable: false });
    } else if (opts.slid && endsInternational(trip) && sinceRelease >= 0 && sinceRelease < AFTER_INTERNATIONAL_HOURS * HOUR) {
      out.push({ trip, rule: "after-international", section: "CBA 2026 7.E.2.c", waivable: false });
    } else if (long && sinceRelease >= 0 && sinceRelease < BUFFER_AFTER_HOURS * HOUR) {
      out.push({ trip, rule: "buffer-after", section: "CBA 2026 7.G.1, 12.D.1.d.ii", waivable: false });
    } else if (longBefore && untilReport >= 0 && untilReport < BUFFER_BEFORE_HOURS * HOUR) {
      if (!(waivable && opts.waiveFrontBuffer)) out.push({ trip, rule: "buffer-before", section: "CBA 2026 7.G.1, 12.D.1.d.i", waivable });
    }
  }
  return out;
}

/** CBA 2026 7.G.1: "The SCH value of the removed trip(s) shall be deducted from the pilot's vacation credit hour bank." */
export function chargedToBank(removed: RemovedTrip[]): number {
  // Each trip once: one in conflict with two vacations comes off the line once, and is charged once.
  const seen = new Set<string>();
  const once = removed.filter((r) => {
    const key = `${r.trip.id}@${r.trip.startDayIndex}`;
    return !seen.has(key) && !!seen.add(key);
  });
  return Math.round(once.reduce((a, r) => a + r.trip.creditHours, 0) * 100) / 100;
}

/** The pack's fourth Thursday of November, and the other days CBA 2026 7.E.3.d names, as "MM-DD". */
function holidayDays(year: number): Set<string> {
  const nov1 = DateTime.utc(year, 11, 1);
  const thanksgiving = nov1.plus({ days: ((4 - nov1.weekday + 7) % 7) + 21 });
  return new Set([thanksgiving.toFormat("MM-dd"), "12-24", "12-25", "12-31", "01-01"]);
}

/** CBA 2026 7.E.3.d: "in whole or in part" on those base days, inside the bid month or past it. */
function touchesHoliday(trip: Trip, pack: BidPack): boolean {
  const span = tripSpan(trip, pack);
  if (!span) return false;
  const zone = zoneOf(pack);
  const shift = baseDayStartMinutes(zone);
  const last = DateTime.fromMillis(span.end - 1, { zone }).minus({ minutes: shift }).startOf("day");
  for (let d = DateTime.fromMillis(span.start, { zone }).minus({ minutes: shift }).startOf("day"); d <= last; d = d.plus({ days: 1 })) {
    if (holidayDays(d.year).has(d.toFormat("MM-dd"))) return true;
  }
  return false;
}

export interface SlideOption {
  offset: number;
  /** The vacation's real-instant span under this option, for drawing its footprint on a calendar. */
  span: Span;
  /** CBA 2026 7.E.3: days the vacation is expanded, earlier and later. */
  expandBefore: number;
  expandAfter: number;
  /** The vacation's first and last base days, "YYYY-MM-DD". */
  firstDay: string;
  lastDay: string;
  removed: RemovedTrip[];
  /** What the removed trips draw from the bank (CBA 2026 7.G.1), and how that compares with the vacation's own value. */
  chargedCH: number;
  /** The line after this: its removed trips gone, its pay unchanged, its vacation days off. */
  line: Line;
  daysOff: number;
  longestOff: number | null;
  weekendsOff: number | null;
  /** On the pilot's own model; null without one. */
  score: number | null;
}

function baseDate(ms: number, zone: string): string {
  // A vacation's last base day runs to 0129 the next morning.
  return DateTime.fromMillis(ms - 2 * HOUR, { zone }).toISODate()!;
}

function optionFor(line: Line, pack: BidPack, vacation: VacationPeriod, span: Span, offset: number, expandBefore: number, expandAfter: number): SlideOption {
  const zone = zoneOf(pack);
  const removed = vacationRemovals(line, pack, span, { slid: offset !== 0 });
  const trips = removed.map((r) => r.trip);
  const spans = new Map<Trip, Span>();
  for (const t of line.trips) {
    const s = tripSpan(t, pack);
    if (s) spans.set(t, s);
  }
  const flown = lineAsFlown(line, pack, trips, spans, new Set(), { creditPaid: true, alsoOff: new Set(dayIndices(span, pack)) });
  return {
    offset,
    span,
    expandBefore,
    expandAfter,
    firstDay: DateTime.fromMillis(span.start, { zone }).toISODate()!,
    lastDay: baseDate(span.end, zone),
    removed,
    chargedCH: chargedToBank(removed),
    line: flown,
    daysOff: flown.daysOff,
    longestOff: longestDaysOffBlock(flown),
    weekendsOff: weekendDaysOff(flown, pack.bidPeriodStart),
    score: null,
  };
}

/**
 * CBA 2026 7.E.3, a regular line, every bid period: expanding "in either or both directions to conflict with a greater number of
 * credit hours". The days before the vacation reaches the next trip each way, when the rules allow them:
 * 7.E.3.b, the conflict can't pass the vacation's own CH value by "more than 6 CH"; 7.E.3.a, not "from December into
 * November, or from January into December"; 7.E.3.c, only trips beginning in this bid month; 7.E.3.d, not a trip on
 * "Thanksgiving Day, Christmas Eve, Christmas Day, New Years Eve or New Year's Day".
 */
function expansions(line: Line, pack: BidPack, vacation: VacationPeriod, slide: SlideCheck, base: SlideOption): SlideOption[] {
  const zone = zoneOf(pack);
  const period = periodSpan(pack);
  if (!period) return [];
  // 7.E.3.c: not "a trip(s) that begins outside the bid period of the pilot's vacation as awarded or slid". This also keeps
  // December out of November and January out of December (7.E.3.a).
  if (slide.span.start >= period.end) return [];
  const limit = vacation.days * CH_PER_VACATION_DAY + EXPANSION_OVER_CH;
  if (base.chargedCH > limit) return [];
  const taken = new Set(base.removed.map((r) => r.trip));
  // Day by day for a run, as the removals are: whole, a run with one day taken started before the vacation ended, so
  // it was neither the trip after nor the one before, and the legal day-longer expansion was never offered.
  const rest = line.trips.flatMap(dayTripsOf).flatMap((t) => {
    const s = tripSpan(t, pack);
    return s && !taken.has(t) ? [{ t, s }] : [];
  });
  // Base days, counted on the base's calendar: as 24 hours each, a day across the spring clock change (23 hours) came up
  // one short, the expansion missed the trip after it, and the option was never offered.
  const daysToReach = (from: number, past: (at: number) => boolean, dir: 1 | -1) => {
    let n = 1;
    while (n < 60 && !past(DateTime.fromMillis(from, { zone }).plus({ days: dir * n }).toMillis())) n++;
    return n;
  };
  const next = rest.filter((x) => x.s.start >= slide.span.end && x.s.start < period.end).sort((a, b) => a.s.start - b.s.start)[0];
  const prior = rest.filter((x) => x.s.end <= slide.span.start && x.s.start >= period.start).sort((a, b) => b.s.end - a.s.end)[0];
  const after = next ? daysToReach(slide.span.end, (at) => at > next.s.start, 1) : 0;
  const before = prior ? daysToReach(slide.span.start, (at) => at < prior.s.end, -1) : 0;
  const tries: [number, number][] = [
    [before, 0],
    [0, after],
    [before, after],
  ];
  const out: SlideOption[] = [];
  for (const [b, a] of tries) {
    if (b === 0 && a === 0) continue;
    if ((b > 0 && !prior) || (a > 0 && !next)) continue;
    const start = DateTime.fromMillis(slide.span.start, { zone }).minus({ days: b }).toMillis();
    const end = DateTime.fromMillis(slide.span.end, { zone }).plus({ days: a }).toMillis();
    // Days added before this month were last month's window to ask for. A vacation awarded from last month into this one
    // still expands forward here: it "may expand within either bid period" (7.E.3.c).
    if (b > 0 && start < period.start) continue;
    const option = optionFor(line, pack, vacation, { start, end }, slide.offset, b, a);
    if (option.chargedCH > limit) continue;
    const added = option.removed.filter((r) => !taken.has(r.trip));
    if (!added.length || added.some((r) => touchesHoliday(r.trip, pack))) continue;
    out.push(option);
  }
  return out;
}

export interface LineSlides {
  line: Line;
  /** Where the line sits in the pilot's order, 1 first. */
  rank: number;
  asAwarded: SlideOption;
  /** Best first, up to `BEST_PER_LINE`; never just the vacation as awarded again. */
  best: SlideOption[];
  /** Every scored option for this line (slides and expansions), best first: for a calendar to slide through. */
  all: SlideOption[];
}

export interface SlideAcrossLines {
  offset: number;
  firstDay: string;
  lastDay: string;
  /** Average days-off change, weighted to the top of the order. */
  gain: number;
  /** How many of the lines looked at it helps. */
  helps: number;
  /** Trips it takes on the pilot's top line. */
  topLine: SlideOption;
}

export interface VacationSlides {
  vacation: VacationPeriod;
  /** What can't be done, with why, for the panel to say so. */
  illegal: SlideCheck[];
  lines: LineSlides[];
  /** The best slide if the pilot doesn't know which line they'll hold, best first. Slides only: an expansion depends on the line. */
  across: SlideAcrossLines[];
  /** The gain is on the pilot's own model. */
  byModel: boolean;
}

const TOP_LINES = 20;
const BEST_PER_LINE = 3;
const BEST_ACROSS = 3;

function sameOutcome(a: SlideOption, b: SlideOption): boolean {
  // By trip and day: a run's days share its id, so taking off its first day and its second read as the same option.
  const ids = (o: SlideOption) => o.removed.map((r) => `${r.trip.id}@${r.trip.startDayIndex}`).sort().join();
  return ids(a) === ids(b) && (a.line.gridOffDays ?? []).join() === (b.line.gridOffDays ?? []).join();
}

/** Without a model: most days off, then the longest run, then the least from the bank. */
function compareWithoutModel(a: SlideOption, b: SlideOption): number {
  return b.daysOff - a.daysOff || (b.longestOff ?? 0) - (a.longestOff ?? 0) || a.chargedCH - b.chargedCH;
}

/**
 * The slides of one vacation over the pilot's top lines, scored on the pilot's own model when there is one: the
 * variations go through the same scorer as the pack, with it, so their scores compare. Heavy on a big pack; run it on a click.
 */
export function findVacationSlides(input: { pack: BidPack; order: string[]; vacation: VacationPeriod; model?: PilotModel | null }): VacationSlides {
  const { pack, order, vacation, model } = input;
  const checks = slideChecks(vacation, pack);
  const legal = checks.filter((c) => c.legal);
  // No bid month dates, so not even the vacation as awarded can be placed: nothing to compare a slide with.
  if (!legal.some((c) => c.offset === 0)) return { vacation, illegal: checks.filter((c) => !c.legal), lines: [], across: [], byModel: !!model };
  const byNumber = new Map(pack.lines.map((l) => [l.lineNumber, l]));
  let top = order.slice(0, TOP_LINES).flatMap((n, i) => {
    const line = byNumber.get(n);
    return line && !line.estimated ? [{ line, rank: i + 1 }] : [];
  });
  // Fall back to the pack's own lines when no ranked order reaches us (a guest who hasn't ranked yet, or the order
  // didn't come through): the slide still has real lines to work on, instead of reporting "0 lines / nothing beats it".
  if (top.length === 0) {
    top = pack.lines.filter((l) => !l.estimated).slice(0, TOP_LINES).map((line, i) => ({ line, rank: i + 1 }));
  }

  const rows = top.map(({ line, rank }) => {
    const options: SlideOption[] = [];
    for (const c of legal) {
      const base = optionFor(line, pack, vacation, c.span, c.offset, 0, 0);
      // 7.E.2.b: this window reaches past the month only for a trip carrying over.
      if (c.carryoverOnly && !base.removed.length) continue;
      options.push(base);
      options.push(...expansions(line, pack, vacation, c, base));
    }
    return { line, rank, options };
  });

  // Score them all with the pack, each a line of its own, so the model's spreads hold across them.
  if (model) {
    const variants = rows.flatMap((r) => r.options.map((o, i) => ({ ...o.line, id: `${r.line.id}::${i}` })));
    // The pack's own lines set the scale, as for a line after a trade: a slide can't move the yardstick it's judged on.
    const all = { ...pack, lines: [...pack.lines, ...variants] };
    const scored = new Map(scorePackV2(all, model, { pack: prepareMetrics(all), referenceLines: pack.lines.length }).map((s) => [s.lineId, s.score]));
    for (const r of rows) r.options.forEach((o, i) => (o.score = scored.get(`${r.line.id}::${i}`) ?? null));
  }
  // Concrete outcomes decide the best slide — most days off, then the longest run, then the bank — and the pilot's
  // model only breaks a true tie. A few days' slide barely moves the model's whole-line score, so ranking on the
  // score first hid slides that plainly add days off (why "no slide beats" came up so often).
  const better = (a: SlideOption, b: SlideOption) => compareWithoutModel(a, b) || (model ? (b.score ?? 0) - (a.score ?? 0) : 0);

  const lines: LineSlides[] = rows.map(({ line, rank, options }) => {
    const asAwarded = options.find((o) => o.offset === 0 && !o.expandBefore && !o.expandAfter)!;
    const best: SlideOption[] = [];
    for (const o of [...options].sort(better)) {
      if (sameOutcome(o, asAwarded) || best.some((b) => sameOutcome(o, b))) continue;
      best.push(o);
      if (best.length === BEST_PER_LINE) break;
    }
    return { line, rank, asAwarded, best, all: [...options].sort(better) };
  });

  const across = legal
    .filter((c) => c.offset !== 0 && !c.carryoverOnly)
    .flatMap((c): SlideAcrossLines[] => {
      if (!rows.length) return [];
      const weighted = rows.map((r) => {
        const asAwarded = r.options.find((o) => o.offset === 0 && !o.expandBefore && !o.expandAfter)!;
        const option = r.options.find((o) => o.offset === c.offset && !o.expandBefore && !o.expandAfter)!;
        // The across-lines verdict is in concrete days off, with or without a model — so "no slide beats" only comes
        // up when no slide actually adds days off, not when a real gain simply didn't move the model's score.
        const gain = option.daysOff - asAwarded.daysOff;
        return { gain, weight: 1 / r.rank, option };
      });
      const total = weighted.reduce((a, w) => a + w.weight, 0);
      return [
        {
          offset: c.offset,
          firstDay: weighted[0].option.firstDay,
          lastDay: weighted[0].option.lastDay,
          gain: Math.round((weighted.reduce((a, w) => a + w.gain * w.weight, 0) / total) * 10) / 10,
          helps: weighted.filter((w) => w.gain > 0).length,
          topLine: weighted[0].option,
        },
      ];
    })
    .sort((a, b) => b.gain - a.gain || Math.abs(a.offset) - Math.abs(b.offset))
    .slice(0, BEST_ACROSS);

  return { vacation, illegal: checks.filter((c) => !c.legal), lines, across, byModel: !!model };
}

/** The pilot's vacations this month's Conflict Input Window can do something with: any that a legal slide makes touch the bid month, or that it already does. */
export function vacationsInReach(vacations: VacationPeriod[], pack: BidPack): VacationPeriod[] {
  const period = periodSpan(pack);
  if (!period) return [];
  const reach = monthReachEnd(pack)!;
  return vacations.filter((v) => slideChecks(v, pack).some((c) => c.legal && c.span.start < reach && c.span.end > period.start));
}

/** A vacation the pilot typed, from its first day: base day to base day, so it's the same shape as the pack's own (0130 to 0129). */
export function typedVacation(firstDay: string, days: number, pack: Pick<BidPack, "base">): VacationPeriod | null {
  const zone = zoneOf(pack);
  const start = DateTime.fromISO(firstDay, { zone }).plus({ minutes: baseDayStartMinutes(zone) });
  if (!start.isValid || !Number.isInteger(days) || days < 1) return null;
  return { from: start.toUTC().toISO()!, to: start.plus({ days }).minus({ minutes: 1 }).toUTC().toISO()!, days };
}

/** A vacation's days on the base's calendar: its first day, and its last (it ends at 0129 the morning after). */
export function vacationLabel(v: VacationPeriod, zone: string): string {
  const first = DateTime.fromISO(v.from, { zone });
  const last = DateTime.fromMillis(Date.parse(v.to) - 2 * HOUR, { zone });
  return `${first.toFormat("LLL d")} to ${last.toFormat("LLL d")} (${v.days} day${v.days === 1 ? "" : "s"})`;
}

/** Where and when to enter it: CBA 2026 25.E.2.b, from the pack's own calendar when it prints it. */
export function slideWhere(pack: BidPack): { opens: string | null; closes: string | null; rule: string } {
  // The printed cells, each under its bid: most of them ("CAP Conflict Input Window Opens") don't name the month, so
  // matching on a "DEC26" at the start found none.
  const printed = bidTimeline(pack).filter((e) => e.source === "pack" && e.bidMonth === pack.month);
  const find = (kind: "conflict-open" | "conflict-close") => printed.find((e) => e.kind === kind)?.at ?? null;
  const rule = newCloseRuleApplies(pack.month)
    ? "It opens 5 hours after your bid closes and runs at least 48 hours (CBA 2026 25.E.2)."
    : "It opens at 1700 CT on the day your bid closes and runs at least 48 hours (CBA 25.E.2).";
  const opens = find("conflict-open");
  // From December 2026 it's counted from the close (CBA 2026 25.E.2, Phase 2).
  if (opens || !newCloseRuleApplies(pack.month)) return { opens, closes: find("conflict-close"), rule };
  const close = packBidClose(pack);
  return { opens: close ? new Date(Date.parse(close.iso) + 5 * HOUR).toISOString() : null, closes: find("conflict-close"), rule };
}
