import { longestDaysOffBlock } from "@/lib/days-off-pattern";
import { carriedDaysOf, dayIndices, flyPack, lineAsFlown, withPrintedLines, type CarryInItem, type FlownLine, type PhaseInElections, type Span } from "@/lib/phase-in";
import { deriveSeniorityInput } from "@/lib/seniority-derive";
import { placeInPack } from "@/lib/strategy-engine";
import { namedWithHours, tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import { CH_PER_VACATION_DAY, chargedToBank, monthReachEnd, vacationRemovals, vacationSpan, type RemovedTrip } from "@/lib/vacation-slide";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/**
 * A regular-line holder's vacation, as awarded, on every line of the bid month, so the line is scored as it will fly.
 * CBA 2026 7.G.1, every bid period: "A regular line holder shall be removed from a trip(s) in conflict with the pilot's
 * vacation period", and "The SCH value of the removed trip(s) shall be deducted from the pilot's vacation credit hour
 * bank". So a removed trip is off the line but still paid. Slides are the slide finder's job (`vacation-slide.ts`); this
 * takes the vacation where it stands. Secondary and reserve lines are charged another way (7.G.2, 7.G.3) and aren't ranked.
 *
 * What the pilot wants done with it is theirs to say:
 *  - "use": the contract's own result, trip off and paid from the bank;
 *  - "keep-flying": the trip still comes off, the contract gives no choice, but its pay isn't counted, and the line's score
 *    falls by the share of its credit the vacation takes (`rankedAsFlown`), so lines it barely touches rise. Our
 *    approximation of a pilot protecting their bank (7.G.6 pays out what's left), not a rule;
 *  - "not-taking": the vacation is off their schedule (traded under 7.E.1.a, or changed with flight management), so it's ignored.
 */
export type VacationChoice = "use" | "keep-flying" | "not-taking";

export const vacationId = (v: Pick<VacationPeriod, "from">): string => v.from;

/** A vacation with what the pilot wants done with it. */
export interface ChosenVacation {
  vacation: VacationPeriod;
  choice: VacationChoice;
}

export interface VacationLine {
  /** The line with the vacation on it. */
  line: Line;
  /** Its trips couldn't all be put on real dates, so nothing was changed. */
  unchecked: boolean;
  removed: RemovedTrip[];
  /** What the removed trips draw from the bank (7.G.1). */
  chargedCH: number;
  /** How far that passes the vacation's own value at 6 CH a day (7.A.1); 0 when it doesn't. */
  overCH: number;
  /** The share of the line's credit taken by vacations the pilot would rather keep flying through, 0 to 1. */
  keepFlyingLoss: number;
  daysOffBefore: number;
  daysOffAfter: number;
  longestOff: number | null;
  reason: string | null;
}

const name = (t: Trip) => (t.pairingNumber ? `trip ${t.pairingNumber}` : "a trip");

/** One line with the pilot's vacations on it. `carriedDays`: days a carry-in is still flying, which a vacation can't make free here. */
export function flyVacationsOnLine(line: Line, pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set()): VacationLine {
  const active = vacations.filter((v) => v.choice !== "not-taking");
  const blank = { line, removed: [], chargedCH: 0, overCH: 0, keepFlyingLoss: 0, daysOffBefore: line.daysOff, daysOffAfter: line.daysOff, longestOff: longestDaysOffBlock(line), reason: null };
  if (!active.length) return { ...blank, unchecked: false };
  const reports = line.trips.map((t) => tripReportUtc(pack, t));
  if (line.estimated || reports.some((r) => r === null)) return { ...blank, unchecked: true };

  const spans = new Map<Trip, Span>(line.trips.map((t, i) => [t, { start: reports[i]!, end: reports[i]! + tripReleaseHours(t) * 3_600_000 }]));
  let flown = line;
  const removed: RemovedTrip[] = [];
  let keepFlyingCH = 0;
  for (const { vacation, choice } of active) {
    const hit = vacationRemovals(flown, pack, vacationSpan(vacation), { slid: false });
    removed.push(...hit);
    if (choice === "keep-flying") keepFlyingCH += chargedToBank(hit);
    flown = lineAsFlown(flown, pack, hit.map((r) => r.trip), spans, carriedDays, { creditPaid: choice === "use", alsoOff: daysOf(vacation, pack) });
  }

  const chargedCH = chargedToBank(removed);
  const value = active.reduce((a, v) => a + v.vacation.days * CH_PER_VACATION_DAY, 0);
  const overCH = Math.max(0, Math.round((chargedCH - value) * 100) / 100);
  const longestOff = longestDaysOffBlock(flown);
  const off = `${flown.daysOff} days off${longestOff ? `, ${longestOff} in a row` : ""}`;
  let reason: string;
  if (!removed.length) {
    reason = `Your vacation sits on days this line already has off, so your bank isn't charged: ${off}.`;
  } else {
    const trips = namedWithHours(removed.map((r) => ({ trip: r.trip, creditHours: r.trip.creditHours })), name);
    const pay = active.every((v) => v.choice === "keep-flying") ? "still paid from your bank, but this line ranks lower since you want to keep your flying" : "paid from your bank";
    reason = `Your vacation takes off ${trips}, ${pay}: ${off}.${overCH > 0 ? ` That's ${overCH.toFixed(1)} CH more than this vacation's ${value} CH.` : ""}`;
  }
  const printedCredit = line.totalCreditHours + (line.carryOverCreditHours ?? 0);
  const keepFlyingLoss = printedCredit > 0 ? Math.min(1, keepFlyingCH / printedCredit) : 0;
  return { line: flown, unchecked: false, removed, chargedCH, overCH, keepFlyingLoss, daysOffBefore: line.daysOff, daysOffAfter: flown.daysOff, longestOff, reason };
}

function daysOf(v: VacationPeriod, pack: BidPack): Set<number> {
  return new Set(dayIndices(vacationSpan(v), pack));
}

/** The whole pack with the pilot's vacations on it, and what happened to each line (by line id). The same pack back when nothing's in play. */
export function flyVacations(pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set()): { pack: BidPack; lines: Map<string, VacationLine> } {
  const lines = new Map<string, VacationLine>();
  if (!vacations.some((v) => v.choice !== "not-taking")) return { pack, lines };
  for (const line of pack.lines) lines.set(line.id, flyVacationsOnLine(line, pack, vacations, carriedDays));
  return { pack: { ...pack, lines: pack.lines.map((l) => lines.get(l.id)!.line) }, lines };
}

/** The pack as this pilot will really fly it: carry-in first, then the vacation over what's left. The same pack back when neither applies. */
export function flySchedule(pack: BidPack, carry: { items: CarryInItem[]; elections: PhaseInElections }, vacations: ChosenVacation[]): { pack: BidPack; lines: Map<string, FlownLine>; vacationLines: Map<string, VacationLine> } {
  const carried = flyPack(pack, carry.items, carry.elections);
  const onVacation = flyVacations(carried.pack, vacations, carriedDaysOf(pack, carry.items));
  return { pack: onVacation.pack, lines: carried.lines, vacationLines: onVacation.lines };
}

/**
 * A ranking made from the flown pack, ready to show: each line back as the pack prints it, and any line a "keep my flying"
 * vacation cuts into marked down by the share of credit it takes. A pilot's priorities may barely weigh credit (the
 * ex-pilot's top lines didn't move for the pay alone), and this is something they've told us outright.
 */
export function rankedAsFlown<T extends { line: Line; score: number }>(scored: T[], pack: BidPack, flown: { pack: BidPack; vacationLines: Map<string, VacationLine> }): T[] {
  const printed = withPrintedLines(scored, pack, flown.pack);
  const lossOf = (s: T) => flown.vacationLines.get(s.line.id)?.keepFlyingLoss ?? 0;
  if (!printed.some((s) => lossOf(s) > 0)) return printed;
  // Stable: lines the choice doesn't touch keep their order among themselves.
  return printed.map((s) => ({ ...s, score: Math.round(s.score * (1 - lossOf(s)) * 10) / 10 })).sort((a, b) => b.score - a.score);
}

/**
 * Whether a vacation can touch this bid month's trips: during them, or close enough that a trip's buffer reaches it (CBA 2026
 * 12.D.1.d, 48 hours after a trip and 24 before). A trip carrying into next month can run into next month's vacation, and
 * 7.G.1 takes it off all the same.
 */
function touchesMonth(v: VacationPeriod, pack: BidPack): boolean {
  const reach = monthReachEnd(pack);
  if (reach === null || !pack.bidPeriodStart) return false;
  return Date.parse(v.from) - 48 * 3_600_000 < reach && Date.parse(v.to) + 24 * 3_600_000 > Date.parse(`${pack.bidPeriodStart}T00:00:00Z`);
}

export interface PilotVacations {
  /** We know which pilot on the pack's list this is. */
  known: boolean;
  /** The pack prints a vacation schedule at all. */
  packHasSchedule: boolean;
  /** Their vacations this bid month can feel. */
  vacations: VacationPeriod[];
}

/** The pilot's vacations from the pack's own schedule, found by their seniority number, or by the seniority they gave Strategies. */
export function pilotVacations(pack: BidPack, profile: Pick<PreferenceProfile, "seniorityNumber"> | null, seniority: SeniorityInput | null): PilotVacations {
  const packHasSchedule = (pack.seniorityList ?? []).some((e) => e.vacations?.length);
  const input = deriveSeniorityInput(pack, profile) ?? seniority;
  const me = input ? placeInPack(pack, input).me : undefined;
  return { known: !!me, packHasSchedule, vacations: (me?.vacations ?? []).filter((v) => touchesMonth(v, pack)) };
}

/** The vacations with the pilot's choice on each; "use" until they say otherwise. */
export function withChoices(vacations: VacationPeriod[], choices: Record<string, VacationChoice> | undefined): ChosenVacation[] {
  return vacations.map((vacation) => ({ vacation, choice: choices?.[vacationId(vacation)] ?? "use" }));
}
