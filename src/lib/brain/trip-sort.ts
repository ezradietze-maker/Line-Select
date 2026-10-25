import { tripDateLabel, tripDuties, tripHeadline } from "@/lib/brain/line-text";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import { hubTurnsOf, summarizeHubTurns } from "@/lib/metrics/hub-turns";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PilotModel, TripChoice } from "@/types/pilot-model";

/**
 * Trip grades: a screen of real trips from the pilot's own best lines, each graded the way they'd size it up on a trade
 * board — love it, good, fine, poor, or trade it away. What decides a month of lines isn't always what decides between
 * two trips (a commuter's commute count dominates their lines, yet on a single trip legs per duty or a city they love
 * can count for much more), and only the pilot's own grades can say by how much. Every two trips graded differently is
 * a choice between them, so one screen of eight says what a dozen "which of these two?" questions would.
 *
 * Chosen on the trip bench (`scripts/eval/trip-lab.ts`, Oct 2026): against trip graders reading each simulated pilot's
 * own words, two screens of eight took trip agreement from 0.71 to 0.80 (the old two pair questions: 0.74), close to
 * what re-weighting alone could ever reach (~0.83); a third screen, asked only when the second one surprised the model,
 * added a little more at half the cost.
 *
 * The trips shown are close calls the model can't yet tell apart, that differ most on the priorities earlier screens
 * haven't tested — and never two dates of the same trip.
 */

/** How the question opens — how the transcript (and the brain) recognizes it. */
export const TRIP_GRADES_LEAD = "Trip grades:";
export const TRIP_GRADES = ["love", "good", "fine", "poor", "trade away"] as const;
export type TripGrade = (typeof TRIP_GRADES)[number];
const GRADE_VALUE: Record<TripGrade, number> = { love: 5, good: 4, fine: 3, poor: 2, "trade away": 1 };

/** Trips per screen. */
export const TRIPS_PER_SCREEN = 8;
/** Screens always asked… */
export const MIN_SCREENS = 2;
/** …and at most this many: one more only while the last screen surprised the model. */
export const MAX_SCREENS = 3;
/** A screen whose comparisons the model already got this share of right didn't surprise it. */
const SURPRISE_BELOW = 0.8;

/** The pilot's best lines, whose trips are the candidates — the trips they'd really be flying. */
const FROM_TOP_LINES = 20;
/** Score points over which "close call" fades: two trips this far apart are worth a quarter less as a question. */
const CLOSE_CALL_POINTS = 8;
/** A priority counts as tested by a screen once its trips' utilities on it spread at least this far. */
const TESTED_SPREAD = 0.2;

export interface TripGradeScreen {
  /** The trips, by `tripKey`, in the order shown. */
  keys: string[];
  /** "Trip #13 · Oct 3", by key. */
  labels: Record<string, string>;
}

export function tripLabel(bidPack: Pick<BidPack, "bidPeriodStart">, t: Trip): string {
  return [`Trip #${t.pairingNumber ?? t.id}`, tripDateLabel(bidPack, t.startDayIndex)].filter(Boolean).join(" · ");
}

/** A trip in full, as text — for the brain and the simulated pilot. */
export function tripText(bidPack: Pick<BidPack, "bidPeriodStart">, t: Trip): string {
  return `${tripHeadline(bidPack, t)}\n${tripDuties(t).join("\n")}`;
}

/** The screens already put to the pilot, read back from the transcript (each trip's key is in braces). */
export function askedTripScreens(exchanges: { question: string }[]): string[][] {
  return exchanges.filter((e) => e.question.startsWith(TRIP_GRADES_LEAD)).map((e) => [...e.question.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
}

/** How a screen goes into the transcript: the trips, with their keys in braces for the record. */
export function tripGradesTranscript(screen: TripGradeScreen): string {
  return `${TRIP_GRADES_LEAD} how would you feel about flying each of these trips? [${screen.keys.map((k) => `${screen.labels[k]} {${k}}`).join("; ")}]`;
}

/** The answer in words, for the transcript the brain reads. */
export function tripGradesAnswer(screen: TripGradeScreen, grades: Record<string, TripGrade | undefined>, why: string): string {
  const graded = screen.keys.filter((k) => grades[k]);
  if (!graded.length) return "(skipped)";
  const note = why.trim() ? ` Why: ${why.trim()}` : "";
  return `${graded.map((k) => `${screen.labels[k]}: ${grades[k]}`).join("; ")}.${note}`;
}

/** Every two trips graded differently, as a choice: "easily" when they're two grades or more apart. */
export function choicesFromGrades(grades: Record<string, TripGrade | undefined>, why?: string): TripChoice[] {
  const graded = Object.entries(grades).flatMap(([key, g]) => (g ? [{ key, v: GRADE_VALUE[g] }] : []));
  const out: TripChoice[] = [];
  for (const a of graded)
    for (const b of graded)
      if (a.v > b.v) out.push({ preferred: a.key, other: b.key, strength: a.v - b.v >= 2 ? "strongly" : "slightly", ...(why?.trim() ? { why: why.trim() } : {}) });
  return out;
}

/** The share of a screen's choices the model already had the right way round (1 when there are none). */
export function shareForeseen(bidPack: BidPack, model: PilotModel, pack: PackMetrics, choices: TripChoice[]): number {
  if (!choices.length) return 1;
  const scores = scoreTripsV2(bidPack, model, { pack });
  const right = choices.filter((c) => (scores.get(c.preferred)?.score ?? 0) > (scores.get(c.other)?.score ?? 0)).length;
  return right / choices.length;
}

/** Whether to ask another screen: always up to `MIN_SCREENS`, then only while the last one surprised the model. */
export function wantsAnotherScreen(screensDone: number, lastForeseen: number | null): boolean {
  if (screensDone < MIN_SCREENS) return true;
  return screensDone < MAX_SCREENS && lastForeseen !== null && lastForeseen < SURPRISE_BELOW;
}

/**
 * The next screen: the closest call among the pilot's best lines' trips that differs most on untested priorities, then
 * the trips that add the most to it. Null when there aren't two trips left to show.
 */
export function pickTripScreen(bidPack: BidPack, model: PilotModel, pack: PackMetrics, shown: string[][], options: { exclude?: Set<string>; size?: number } = {}): TripGradeScreen | null {
  if (model.criteria.length < 2) return null;
  const scores = scoreTripsV2(bidPack, model, { pack });
  const byKey = new Map(bidPack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t]));
  const shownPairings = new Set(shown.flat().map((k) => byKey.get(k)?.id).filter(Boolean));

  // How often each priority has been tested already: trips on a screen that spread widely on it.
  const tested = new Map<string, number>();
  for (const keys of shown) {
    const rs = keys.map((k) => scores.get(k)).filter((x) => !!x);
    for (const r of rs[0]?.results ?? []) {
      const us = rs.map((x) => x.results.find((y) => y.criterionId === r.criterionId)?.utility ?? 0);
      if (Math.max(...us) - Math.min(...us) > TESTED_SPREAD) tested.set(r.criterionId, (tested.get(r.criterionId) ?? 0) + 1);
    }
  }

  // One date of each trip the pilot's best lines fly, never one already shown.
  const top = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score).slice(0, FROM_TOP_LINES);
  const byPairing = new Map<string, Trip>();
  for (const s of top)
    for (const t of bidPack.lines.find((l) => l.id === s.lineId)?.trips ?? [])
      if (scores.has(tripKey(t)) && !byPairing.has(t.id) && !shownPairings.has(t.id) && !options.exclude?.has(tripKey(t))) byPairing.set(t.id, t);
  const trips = [...byPairing.values()];

  const novelty = (id: string) => 1 / (1 + (tested.get(id) ?? 0));
  const value = (a: Trip, b: Trip) => {
    const A = scores.get(tripKey(a))!;
    const B = scores.get(tripKey(b))!;
    let info = 0;
    for (const ra of A.results) {
      const rb = B.results.find((x) => x.criterionId === ra.criterionId);
      if (!rb || ra.value === null || rb.value === null) continue;
      info += Math.abs(ra.utility - rb.utility) * ra.weight * novelty(ra.criterionId);
    }
    return info / (1 + (Math.abs(A.score - B.score) / CLOSE_CALL_POINTS) ** 2);
  };
  let best: [Trip, Trip] | null = null;
  let bestValue = -1;
  for (let i = 0; i < trips.length; i++)
    for (let j = i + 1; j < trips.length; j++) {
      const v = value(trips[i], trips[j]);
      if (v > bestValue) {
        bestValue = v;
        best = [trips[i], trips[j]];
      }
    }
  if (!best) return null;
  const chosen: Trip[] = [...best];
  const size = options.size ?? TRIPS_PER_SCREEN;
  while (chosen.length < size) {
    const next = trips
      .filter((t) => !chosen.includes(t))
      .map((t) => ({ t, v: chosen.reduce((s, c) => s + value(t, c), 0) }))
      .sort((a, b) => b.v - a.v)[0];
    if (!next) break;
    chosen.push(next.t);
  }
  // The first screen gets a week of night hub turns when the pilot's best lines fly one, so their own grade says how much
  // it counts — the kind of trip the ex-pilot called onerous, and one a model can't weigh from words alone.
  const weekOfNights = (t: Trip) => summarizeHubTurns(hubTurnsOf([t], bidPack)).inWeeks > 0;
  if (!shown.length && chosen.length >= 3 && !chosen.some(weekOfNights)) {
    const hubTrip = trips.filter((t) => !chosen.includes(t) && weekOfNights(t)).sort((a, b) => chosen.reduce((s, c) => s + value(b, c), 0) - chosen.reduce((s, c) => s + value(a, c), 0))[0];
    if (hubTrip) chosen[chosen.length - 1] = hubTrip;
  }
  // Shown in date order, the way a pilot reads a month.
  chosen.sort((a, b) => (a.startDayIndex ?? 0) - (b.startDayIndex ?? 0));
  return { keys: chosen.map(tripKey), labels: Object.fromEntries(chosen.map((t) => [tripKey(t), tripLabel(bidPack, t)])) };
}
