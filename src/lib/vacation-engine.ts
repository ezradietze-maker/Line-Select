import { longestDaysOffBlock, weekendDaysOff } from "@/lib/days-off-pattern";
import { zoneOf } from "@/lib/phase-in";
import { tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import { flyVacationsOnLine, vacationId, type ChosenVacation, type VacationLine, type VacationPlacement } from "@/lib/vacation-lines";
import { expandedSpan, expansionLimitCH, expansionReach, frontBufferWaivable, periodSpan, slideChecks, touchesHoliday, type SlideCheck } from "@/lib/vacation-slide";
import type { BidPack, Line } from "@/types/bidpack";

/**
 * Every legal place the pilot's vacation can go on every line, worked out once, and the best of them for what the
 * pilot wants from it. A vacation slides whole, up to 5 days either way, in the Conflict Input Window (CBA 2026 7.E.2.a,
 * 7.G.1); the trips it then conflicts with come off the line and are paid from the vacation bank.
 *
 * One path for the math: each option is the line flown by `flyVacationsOnLine` with that placement, the very call the
 * ranking makes when it scores a line with its slide (`flySchedule`'s `placements`). So what an option promises (its
 * days off, what it takes off, what it draws from the bank) is what the ranked line has. Only slides here: expansion
 * (7.E.3) waits, by the owner's call.
 */

const HOUR = 3_600_000;

/** What one placement does to one line, in the terms a goal weighs. */
export interface VacationOption {
  placement: VacationPlacement;
  /** "0", "+3", "-2/+1" (two vacations), "+2x1_0" (expanded 1 day earlier), "+3w" (front buffer waived): the same placement on every line has the same key. */
  key: string;
  /** Days moved and expanded in all, each vacation's counted: 0 as awarded. The least-change tiebreak and "as awarded" default. */
  shift: number;
  /** CBA 2026 7.E.3: days the vacation is expanded past its slide, earlier and later. 0 for a plain slide. */
  expandBefore: number;
  expandAfter: number;
  daysOff: number;
  longestOff: number | null;
  weekendsOff: number | null;
  /** The vacation bank's draw: the credit of every trip it takes off (CBA 2026 7.G.1). */
  bankCH: number;
  /** The credit left to fly this bid month. */
  flownCH: number;
  /** Trips it takes off, by pairing number, and the layover cities on them. */
  removedPairings: string[];
  removedCities: string[];
  /** The bid month's days off, by day index: the vacation's own days and the line's. Null for a line without a grid. */
  offDays: number[] | null;
  /** The front 24 hours before a long international trip waived, to keep the trip (from December 2026). */
  waived: boolean;
}

export interface LineVacationOptions {
  lineId: string;
  /** Every legal placement on this line; the first is as awarded. */
  options: VacationOption[];
  /** For each vacation, how far it can slide on this line each way (the hashes either side of it), in days. */
  reach: { id: string; earlier: number; later: number }[];
}

/** The legal whole-day slides of each vacation this bid month (the same on every line, but for 7.E.2.b's carryovers). */
function legalSlides(vacations: ChosenVacation[], pack: BidPack): Map<string, SlideCheck[]> {
  return new Map(vacations.map(({ vacation }) => [vacationId(vacation), slideChecks(vacation, pack).filter((c) => c.legal)]));
}

const keyOf = (offsets: number[], waived: boolean, expand?: { before: number; after: number }) =>
  offsets.map((o) => (o > 0 ? `+${o}` : String(o))).join("/") + (expand && (expand.before || expand.after) ? `x${expand.before}_${expand.after}` : "") + (waived ? "w" : "");

/** Every combination of the vacations' offsets (two vacations: up to 11 × 11), as awarded first. */
function combinations(lists: number[][]): number[][] {
  let out: number[][] = [[]];
  for (const list of lists) out = out.flatMap((head) => list.map((o) => [...head, o]));
  return out.sort((a, b) => a.reduce((s, o) => s + Math.abs(o), 0) - b.reduce((s, o) => s + Math.abs(o), 0));
}

function optionFrom(placement: VacationPlacement, offsets: number[], waived: boolean, vl: VacationLine, pack: BidPack, expand: { before: number; after: number } = { before: 0, after: 0 }): VacationOption {
  const flown = vl.line;
  return {
    placement,
    key: keyOf(offsets, waived, expand),
    shift: offsets.reduce((s, o) => s + Math.abs(o), 0) + expand.before + expand.after,
    expandBefore: expand.before,
    expandAfter: expand.after,
    daysOff: flown.daysOff,
    longestOff: longestDaysOffBlock(flown),
    weekendsOff: weekendDaysOff(flown, pack.bidPeriodStart),
    bankCH: vl.chargedCH,
    flownCH: Math.round(flown.trips.filter((t) => !vl.removed.some((r) => r.trip === t)).reduce((a, t) => a + t.creditHours, 0) * 100) / 100,
    removedPairings: [...new Set(vl.removed.map((r) => r.trip.pairingNumber ?? "").filter(Boolean))],
    removedCities: [...new Set(vl.removed.flatMap((r) => r.trip.layoverCities ?? []))],
    offDays: flown.gridOffDays ? [...flown.gridOffDays].sort((a, b) => a - b) : null,
    waived,
  };
}

/**
 * Every legal placement of the pilot's vacations on one line (`line` after the carry-in, `carriedDays` the days a
 * carry-in still flies). Two vacations are placed together, never on top of each other. Slides past the month's end
 * count only where they reach one of this line's trips that carries over (7.E.2.b). Where the pilot may waive the front
 * buffer (from December 2026) and a placement loses a trip to it, the placement with the trip kept is an option too.
 */
export function lineVacationOptions(line: Line, pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set(), slides = legalSlides(vacations, pack)): LineVacationOptions {
  const active = vacations.filter((v) => v.choice !== "not-taking");
  const ids = active.map(({ vacation }) => vacationId(vacation));
  if (!active.length) return { lineId: line.id, options: [], reach: [] };
  const period = periodSpan(pack);
  const zone = zoneOf(pack);
  const waivable = frontBufferWaivable(pack.month);
  const carriesOver = (vl: VacationLine) => period !== null && vl.removed.some((r) => {
    const report = tripReportUtc(pack, r.trip);
    return report !== null && report + tripReleaseHours(r.trip) * HOUR > period.end;
  });
  const lists = ids.map((id) => (slides.get(id) ?? []).map((c) => c.offset));
  const options: VacationOption[] = [];
  for (const offsets of combinations(lists)) {
    const placement: VacationPlacement = { offsets: Object.fromEntries(ids.map((id, i) => [id, offsets[i]])) };
    const vl = flyVacationsOnLine(line, pack, vacations, carriedDays, placement);
    if (vl.unchecked) continue;
    // Two vacations slid onto each other aren't two vacations.
    if (vl.spans.some((a, i) => vl.spans.some((b, j) => i < j && a.start < b.end && b.start < a.end))) continue;
    // 7.E.2.b: this month's window reaches past the month only for a trip of it that carries over.
    const pastMonth = ids.some((id, i) => (slides.get(id) ?? []).find((c) => c.offset === offsets[i])?.carryoverOnly);
    if (pastMonth && !carriesOver(vl)) continue;
    options.push(optionFrom(placement, offsets, false, vl, pack));
    if (waivable && vl.removed.some((r) => r.rule === "buffer-before" && r.waivable)) {
      const kept = { ...placement, waiveFrontBuffer: true };
      options.push(optionFrom(kept, offsets, true, flyVacationsOnLine(line, pack, vacations, carriedDays, kept), pack));
    }
    // CBA 2026 7.E.3: in addition to the slide, expand the vacation outward to take off more credit. One vacation only
    // (the common case); two in a month are left to slides. Reuses the tested checks in `vacation-slide.ts`.
    if (active.length === 1 && period) {
      const id = ids[0];
      const slide = (slides.get(id) ?? []).find((c) => c.offset === offsets[0]);
      const limit = expansionLimitCH(active[0].vacation.days);
      // 7.E.3.c: expand only from a span in this bid period; 7.E.3.b: the slide's own conflict must already be within the cap.
      if (slide && slide.span.start < period.end && vl.chargedCH <= limit) {
        const taken = new Set(vl.removed.map((r) => r.trip));
        const { before, after } = expansionReach(line, pack, slide.span, taken);
        for (const [b, a] of [[before, 0], [0, after], [before, after]] as [number, number][]) {
          if (b === 0 && a === 0) continue;
          // 7.E.3.c again: a day added before this bid month was last month's window to ask for.
          if (b > 0 && expandedSpan(slide.span, b, 0, zone).start < period.start) continue;
          const expand = { before: b, after: a };
          const expanded: VacationPlacement = { offsets: placement.offsets, expand: { [id]: expand } };
          const evl = flyVacationsOnLine(line, pack, vacations, carriedDays, expanded);
          // 7.E.3.b cap on the whole conflict; 7.E.3.d no holiday trip pulled in; and it must take off something new.
          if (evl.unchecked || evl.chargedCH > limit) continue;
          const added = evl.removed.filter((r) => !taken.has(r.trip));
          if (!added.length || added.some((r) => touchesHoliday(r.trip, pack))) continue;
          options.push(optionFrom(expanded, offsets, false, evl, pack, expand));
        }
      }
    }
  }
  const reach = ids.map((id) => {
    const legal = options.map((o) => o.placement.offsets[id] ?? 0);
    return { id, earlier: Math.max(0, -Math.min(0, ...legal)), later: Math.max(0, ...legal) };
  });
  return { lineId: line.id, options, reach };
}

/**
 * The whole pack's options as small tasks, a few lines each, for the page to run a slice at a time (as the ranking's
 * warm-up does) instead of freezing for seconds: a big pack has thousands of placements. Each task fills `into`.
 */
export function vacationOptionTasks(pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number>, into: Map<string, LineVacationOptions>, linesPerTask = 8): (() => void)[] {
  const slides = legalSlides(vacations, pack);
  const tasks: (() => void)[] = [];
  for (let i = 0; i < pack.lines.length; i += linesPerTask) {
    const chunk = pack.lines.slice(i, i + linesPerTask);
    tasks.push(() => {
      for (const line of chunk) into.set(line.id, lineVacationOptions(line, pack, vacations, carriedDays, slides));
    });
  }
  return tasks;
}

/** All of it at once, for tests and scripts. */
export function vacationOptions(pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set()): Map<string, LineVacationOptions> {
  const into = new Map<string, LineVacationOptions>();
  for (const task of vacationOptionTasks(pack, vacations, carriedDays, into)) task();
  return into;
}

// ---------------------------------------------------------------- what the pilot wants from it

/**
 * One thing a pilot can want from their vacation, as the goal box reads it:
 *  - "credit": the most trip credit under it, paid from the bank (CBA 2026 7.G.1) — the bank's hours paid in full as
 *    trips rather than bought back at 40% at the year's end (7.G.6);
 *  - "keep-bank": the least under it, the bank kept;
 *  - "days-off", "stretch", "weekends": the most days off, the longest run of them, the most weekend days;
 *  - "dates": these bid-month days off (day indices);
 *  - "drop" / "keep": its trips touching these cities (or pairings) taken off, or kept flying;
 *  - "as-awarded": where the pack has it.
 */
export type VacationAim =
  | { kind: "credit" }
  | { kind: "keep-bank" }
  | { kind: "days-off" }
  | { kind: "stretch" }
  | { kind: "weekends" }
  | { kind: "dates"; days: number[] }
  | { kind: "drop"; cities?: string[]; pairings?: string[] }
  | { kind: "keep"; cities?: string[]; pairings?: string[] }
  | { kind: "as-awarded" };

/** What the pilot wants, most important first: a later aim only decides between options the earlier ones call equal. */
export interface VacationGoal {
  aims: VacationAim[];
}

/** How much an option gives of one aim, more being better. */
export function aimValue(aim: VacationAim, o: VacationOption): number {
  const touches = (want: { cities?: string[]; pairings?: string[] }) =>
    (want.cities ?? []).filter((c) => o.removedCities.includes(c.toUpperCase())).length + (want.pairings ?? []).filter((p) => o.removedPairings.includes(p)).length;
  switch (aim.kind) {
    case "credit":
      return o.bankCH;
    case "keep-bank":
      return -o.bankCH;
    case "days-off":
      return o.daysOff;
    case "stretch":
      return o.longestOff ?? 0;
    case "weekends":
      return o.weekendsOff ?? 0;
    case "dates":
      return o.offDays ? aim.days.filter((d) => o.offDays!.includes(d)).length : 0;
    case "drop":
      return touches(aim);
    case "keep":
      return -touches(aim);
    case "as-awarded":
      return -o.shift;
  }
}

/** Two options give the same of an aim within this: a minute of credit, or the same count of days. */
const SAME = 1 / 60 + 1e-9;

/**
 * Better first, by the goal's aims in order. Then the least slide (as awarded, all else equal: nothing to ask for in the
 * Conflict Input Window), then the trip kept without a waiver.
 */
export function compareOptions(goal: VacationGoal, a: VacationOption, b: VacationOption): number {
  for (const aim of goal.aims) {
    const d = aimValue(aim, b) - aimValue(aim, a);
    if (Math.abs(d) > SAME) return d;
  }
  // Least change first, then a slide ahead of an expansion (the bigger ask) on a true tie, then the trip kept without a waiver.
  const expanded = (o: VacationOption) => Number(o.expandBefore > 0 || o.expandAfter > 0);
  return a.shift - b.shift || expanded(a) - expanded(b) || Number(a.waived) - Number(b.waived);
}

/** The line's best placement for the goal; as awarded with no goal, or none to choose from. */
export function bestOption(line: LineVacationOptions, goal: VacationGoal | null): VacationOption | null {
  if (!line.options.length) return null;
  if (!goal || !goal.aims.length) return line.options[0];
  return line.options.reduce((best, o) => (compareOptions(goal, o, best) < 0 ? o : best));
}

/** Each line's best placement, for `flySchedule`: only the lines it moves, so as awarded stays the default. */
export function bestPlacements(all: ReadonlyMap<string, LineVacationOptions>, goal: VacationGoal | null): Map<string, VacationPlacement> {
  const out = new Map<string, VacationPlacement>();
  for (const [id, line] of all) {
    const best = bestOption(line, goal);
    if (best && best.shift > 0) out.set(id, best.placement);
    else if (best?.waived) out.set(id, best.placement);
  }
  return out;
}
