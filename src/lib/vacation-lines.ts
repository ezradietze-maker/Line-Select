import { longestDaysOffBlock } from "@/lib/days-off-pattern";
import { carriedDaysOf, dayIndices, flyPack, lineAsFlown, withPrintedLines, zoneOf, type CarryInItem, type FlownLine, type PhaseInElections, type Span } from "@/lib/phase-in";
import { formatHoursValue } from "@/lib/interview-config";
import type { CarryInState } from "@/lib/carry-in-storage";
import { findMyVacation, type MyVacation } from "@/lib/my-vacation";
import { namedWithHours, tripReleaseHours, tripReportUtc } from "@/lib/trip-anchor";
import { CH_PER_VACATION_DAY, chargedToBank, freeTimeReasons, shifted, vacationRemovals, vacationSpan, type RemovedTrip } from "@/lib/vacation-slide";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

/**
 * A regular-line holder's vacation, as awarded, on every line of the bid month, so the line is scored as it will fly.
 * CBA 2026 7.G.1, every bid period: "A regular line holder shall be removed from a trip(s) in conflict with the pilot's
 * vacation period", and "The SCH value of the removed trip(s) shall be deducted from the pilot's vacation credit hour
 * bank". So a removed trip is off the line but still paid. Slides are placed by `vacation-engine.ts`, passed here as a `placement`; this
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
  /** Where each vacation (that's being taken) lands on this line: as awarded, or where `placement` slid it. */
  spans: Span[];
}

/**
 * Where a line has the pilot's vacations: each slid whole days from where it was awarded (negative earlier), by
 * `vacationId`; absent, as awarded. `waiveFrontBuffer`: the pilot waives the 24 hours before a long international trip,
 * from December 2026 (CBA 2026 7.G.1, 12.D.1.d.i).
 */
export interface VacationPlacement {
  offsets: Record<string, number>;
  waiveFrontBuffer?: boolean;
}

const name = (t: Trip) => (t.pairingNumber ? `trip ${t.pairingNumber}` : "a trip");

/** One line with the pilot's vacations on it. `carriedDays`: days a carry-in is still flying, which a vacation can't make free here. */
export function flyVacationsOnLine(line: Line, pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set(), placement?: VacationPlacement): VacationLine {
  const active = vacations.filter((v) => v.choice !== "not-taking");
  const blank = { line, removed: [], chargedCH: 0, overCH: 0, keepFlyingLoss: 0, daysOffBefore: line.daysOff, daysOffAfter: line.daysOff, longestOff: longestDaysOffBlock(line), reason: null, spans: [] };
  if (!active.length) return { ...blank, unchecked: false };
  const reports = line.trips.map((t) => tripReportUtc(pack, t));
  if (line.estimated || reports.some((r) => r === null)) return { ...blank, unchecked: true };

  const spans = new Map<Trip, Span>(line.trips.map((t, i) => [t, { start: reports[i]!, end: reports[i]! + tripReleaseHours(t) * 3_600_000 }]));
  let flown = line;
  const removed: RemovedTrip[] = [];
  const placed: Span[] = [];
  let keepFlyingCH = 0;
  const zone = zoneOf(pack);
  for (const { vacation, choice } of active) {
    // Where this line has it: as awarded, or slid whole days (CBA 2026 7.E.2.a, 7.G.1: "slides as a whole"). A slide brings
    // in 7.E.2.c's 48 hours after an international trip; the front buffer is waived only where the pilot can (`placement`).
    const offset = placement?.offsets[vacationId(vacation)] ?? 0;
    const span = offset ? shifted(vacation, offset, zone) : vacationSpan(vacation);
    placed.push(span);
    const hit = vacationRemovals(flown, pack, span, { slid: offset !== 0, waiveFrontBuffer: placement?.waiveFrontBuffer });
    removed.push(...hit);
    if (choice === "keep-flying") keepFlyingCH += chargedToBank(hit);
    flown = lineAsFlown(flown, pack, hit.map((r) => r.trip), spans, carriedDays, { creditPaid: choice === "use", alsoOff: new Set(dayIndices(span, pack)) });
  }

  const chargedCH = chargedToBank(removed);
  const value = active.reduce((a, v) => a + v.vacation.days * CH_PER_VACATION_DAY, 0);
  const overCH = Math.max(0, Math.round((chargedCH - value) * 100) / 100);
  const longestOff = longestDaysOffBlock(flown);
  const off = `${flown.daysOff} days off${longestOff ? `, ${longestOff} in a row` : ""}`;
  let reason: string;
  const moved = active.map(({ vacation }) => placement?.offsets[vacationId(vacation)] ?? 0).find((o) => o !== 0);
  const slid = moved ? `Slid ${Math.abs(moved)} day${Math.abs(moved) === 1 ? "" : "s"} ${moved > 0 ? "later" : "earlier"}, y` : "Y";
  if (!removed.length) {
    reason = `${slid}our vacation sits on days this line already has off, so your bank isn't charged: ${off}.`;
  } else {
    const trips = namedWithHours(removed.map((r) => ({ trip: r.trip, creditHours: r.trip.creditHours })), name);
    const pay = active.every((v) => v.choice === "keep-flying") ? "still paid from your bank, but this line ranks lower since you want to keep your flying" : "paid from your bank";
    reason = `${slid}our vacation takes off ${trips}, ${pay}: ${off}.${overCH > 0 ? ` That's ${formatHoursValue(overCH)} CH more than this vacation's ${formatHoursValue(value)} CH.` : ""}${freeTimeReasons(removed).map((s) => ` ${s}`).join("")}`;
  }
  const printedCredit = line.totalCreditHours + (line.carryOverCreditHours ?? 0);
  const keepFlyingLoss = printedCredit > 0 ? Math.min(1, keepFlyingCH / printedCredit) : 0;
  return { line: flown, unchecked: false, removed, chargedCH, overCH, keepFlyingLoss, daysOffBefore: line.daysOff, daysOffAfter: flown.daysOff, longestOff, reason, spans: placed };
}

/** The whole pack with the pilot's vacations on it, and what happened to each line (by line id). The same pack back when nothing's in play. */
export function flyVacations(pack: BidPack, vacations: ChosenVacation[], carriedDays: Set<number> = new Set(), placements?: ReadonlyMap<string, VacationPlacement>): { pack: BidPack; lines: Map<string, VacationLine> } {
  const lines = new Map<string, VacationLine>();
  if (!vacations.some((v) => v.choice !== "not-taking")) return { pack, lines };
  for (const line of pack.lines) lines.set(line.id, flyVacationsOnLine(line, pack, vacations, carriedDays, placements?.get(line.id)));
  return { pack: { ...pack, lines: pack.lines.map((l) => lines.get(l.id)!.line) }, lines };
}

/** The pack as this pilot will really fly it: carry-in first, then the vacation over what's left. The same pack back when neither applies. */
export function flySchedule(
  pack: BidPack,
  carry: { items: CarryInItem[]; elections: PhaseInElections },
  vacations: ChosenVacation[],
  placements?: ReadonlyMap<string, VacationPlacement>
): { pack: BidPack; lines: Map<string, FlownLine>; vacationLines: Map<string, VacationLine>; carriedPack: BidPack; carriedDays: Set<number> } {
  const carried = flyPack(pack, carry.items, carry.elections);
  const carriedDays = carriedDaysOf(pack, carry.items);
  const onVacation = flyVacations(carried.pack, vacations, carriedDays, placements);
  // The pack after the carry-in and before the vacation, and the days the carry-in still flies: where every placement of
  // the vacation is tried from (`lib/vacation-engine.ts`).
  return { pack: onVacation.pack, lines: carried.lines, vacationLines: onVacation.lines, carriedPack: carried.pack, carriedDays };
}

/**
 * A ranking made from the flown pack, ready to show: each line back as the pack prints it, and any line a "keep my flying"
 * vacation cuts into marked down by the share of credit it takes. A pilot's priorities may barely weigh credit (the
 * ex-pilot's top lines didn't move for the pay alone), and this is something they've told us outright.
 */
export function rankedAsFlown<T extends { line: Line; score: number }>(
  scored: T[],
  pack: BidPack,
  flown: { pack: BidPack; vacationLines: Map<string, VacationLine> },
  /** Each line's score as the pack prints it (`rankLines` on the pack itself), to tell apart lines the month leaves the same. */
  printedScores?: ReadonlyMap<string, number> | null
): T[] {
  const printed = withPrintedLines(scored, pack, flown.pack);
  const lossOf = (s: T) => flown.vacationLines.get(s.line.id)?.keepFlyingLoss ?? 0;
  // Stable: lines the choice doesn't touch keep their order among themselves.
  const kept = printed.some((s) => lossOf(s) > 0) ? printed.map((s) => ({ ...s, score: Math.round(s.score * (1 - lossOf(s)) * 10) / 10 })).sort((a, b) => b.score - a.score) : printed;
  return printedScores ? tiesByPrinted(kept, printedScores) : kept;
}

/**
 * How far apart lines the pilot's month leaves the same are spread: this share of how far each one's printed score sits
 * from its group's average. With the owner's 15-day vacation on the ex-pilot's profile (777 Captain, Oct 2026), it took
 * every trip off 127 of 283 lines, so all 127 scored alike and read 33.8; spread at 0.2 they read from 42.5 to 25.8 with
 * 78 different scores, the top 20 unchanged (0.1: 54 different; 0.3: 91, but more of the list reshuffled).
 */
export const PRINTED_TIE_SHARE = 0.2;

/**
 * Lines the pilot's month leaves scoring alike — a vacation taking every trip off them, or twin lines — told apart by
 * the lines as the pack prints them: the trips they'd fly if the vacation slides or the pilot keeps flying. Each moves
 * from the shared score by `PRINTED_TIE_SHARE` of how far its printed score is from the group's average, so the group
 * stays centred where it was; a line scoring alone is left as it is. Lines identical as printed stay tied.
 */
export function tiesByPrinted<T extends { line: Line; score: number }>(ranked: T[], printedScores: ReadonlyMap<string, number>): T[] {
  const groups = new Map<number, T[]>();
  for (const r of ranked) groups.set(r.score, [...(groups.get(r.score) ?? []), r]);
  const shifted = new Map<T, number>();
  for (const [score, group] of groups) {
    if (group.length < 2 || group.some((r) => !printedScores.has(r.line.id))) continue;
    const mean = group.reduce((a, r) => a + printedScores.get(r.line.id)!, 0) / group.length;
    for (const r of group) shifted.set(r, score + PRINTED_TIE_SHARE * (printedScores.get(r.line.id)! - mean));
  }
  if (!shifted.size) return ranked;
  return ranked.map((r) => (shifted.has(r) ? { ...r, score: shifted.get(r)! } : r)).sort((a, b) => b.score - a.score);
}

export interface PilotVacations extends MyVacation {
  /** We know which vacation is theirs: found on the pack's schedule (with or without one this month), or typed. */
  known: boolean;
}

/** The pilot's vacations: from the pack's own schedule by their seniority number, or as they typed them (`findMyVacation`). */
export function pilotVacations(
  pack: BidPack,
  profile: Pick<PreferenceProfile, "seniorityNumber"> | null,
  seniority: SeniorityInput | null,
  typed?: Pick<CarryInState, "typedVacations" | "preferTyped">
): PilotVacations {
  const found = findMyVacation(pack, profile, seniority, { vacations: typed?.typedVacations, preferTyped: typed?.preferTyped });
  return { ...found, known: found.status === "found" || found.status === "none" || found.status === "typed" };
}

/** The vacations with the pilot's choice on each; "use" until they say otherwise. */
export function withChoices(vacations: VacationPeriod[], choices: Record<string, VacationChoice> | undefined): ChosenVacation[] {
  return vacations.map((vacation) => ({ vacation, choice: choices?.[vacationId(vacation)] ?? "use" }));
}
