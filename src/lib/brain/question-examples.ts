import { formatValue } from "@/lib/brain/describe";
import { tripHeadline } from "@/lib/brain/line-text";
import { tripLabel } from "@/lib/brain/trip-sort";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, tripKey, tripReadingOf, tripValueText } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Real examples to put with the interview's questions. Asked in the abstract — "how many commutes before it bothers
 * you?", "how much layover would you give up for an easy commute?" — a pilot has to imagine the lines, and the ex-pilot
 * said plainly it's hard to answer in a generic way and he'd rather be shown specific lines and trips. So each turn the
 * interviewer is offered, for each of the pilot's main priorities, real lines (and trips, where one trip shows it) from
 * their own pack at both ends of it, with the pilot's own figure on each — and every question shows one or two.
 *
 * Lines come from the pilot's best lines when those differ on the priority — the lines they'd really be choosing
 * between — and from the whole pack when they don't.
 */

export interface QuestionExample {
  /** "E3" — how the interviewer refers to it. */
  id: string;
  kind: "line" | "trip";
  /** The line's number, or the trip's key (`tripKey`). */
  ref: string;
  /** "Line 1016", "Trip #10 · Oct 4". */
  title: string;
  /** The priority it shows, in the pilot's terms, and the line's or trip's figure on it: "Few departures: 5 departures". */
  fact: string;
  /** The priority's id in their reading — a question's examples all show one priority. */
  criterionId?: string;
  /** The line or trip in brief, for the interviewer and the transcript. */
  summary: string;
  /** For a line: where it sits on their current list. */
  rank?: number;
}

/** Priorities examples are offered for, most important first. */
const MAX_CRITERIA = 8;
/** The pilot's best lines — where examples come from when they differ. */
const FROM_TOP = 20;
/** Two lines this far apart (utility) show a priority; closer, the difference is noise. */
const MIN_GAP = 0.3;
/** No line or trip is offered for more than this many priorities in one turn. */
const MAX_PER_ITEM = 2;
const MAX_EXAMPLES = 24;

function lineBrief(line: Line): string {
  return `${line.trips.length} ${line.trips.length === 1 ? "trip" : "trips"}, ${line.daysOff} days off, ${line.totalCreditHours.toFixed(1)} credit`;
}

export function pickQuestionExamples(bidPack: BidPack, model: PilotModel, pack: PackMetrics): QuestionExample[] {
  const criteria = [...model.criteria].sort((a, b) => b.weight - a.weight).slice(0, MAX_CRITERIA);
  if (!criteria.length) return [];
  const ranked = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score);
  const rankOf = new Map(ranked.map((r, i) => [r.lineNumber, i + 1]));
  const lineOf = new Map(bidPack.lines.map((l) => [l.lineNumber, l]));
  const trips = scoreTripsV2(bidPack, model, { pack });
  const tripOf = new Map(bidPack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t] as const));
  const topTrips = new Set(ranked.slice(0, FROM_TOP).flatMap((r) => lineOf.get(r.lineNumber)?.trips.map(tripKey) ?? []));

  const out: QuestionExample[] = [];
  const used = new Map<string, number>();
  const add = (e: Omit<QuestionExample, "id">) => {
    const key = `${e.kind}:${e.ref}`;
    if ((used.get(key) ?? 0) >= MAX_PER_ITEM || out.length >= MAX_EXAMPLES) return;
    used.set(key, (used.get(key) ?? 0) + 1);
    out.push({ ...e, id: `E${out.length + 1}` });
  };

  for (const c of criteria) {
    const def = METRICS_BY_ID.get(c.metric);
    if (!def) continue;
    const at = (r: (typeof ranked)[number]) => r.results.find((x) => x.criterionId === c.id);
    const measured = (rs: typeof ranked) => rs.filter((r) => at(r)?.value !== null && at(r) !== undefined);
    // The two ends of this priority among their best lines — or the whole pack when their best lines don't differ on it.
    let pool = measured(ranked.slice(0, FROM_TOP));
    const spread = (rs: typeof ranked) => (rs.length ? Math.max(...rs.map((r) => at(r)!.utility)) - Math.min(...rs.map((r) => at(r)!.utility)) : 0);
    if (spread(pool) < MIN_GAP) pool = measured(ranked);
    if (spread(pool) >= MIN_GAP) {
      const byUtility = [...pool].sort((a, b) => at(a)!.utility - at(b)!.utility || rankOf.get(a.lineNumber)! - rankOf.get(b.lineNumber)!);
      for (const r of [byUtility[byUtility.length - 1], byUtility[0]]) {
        const line = lineOf.get(r.lineNumber)!;
        add({ kind: "line", ref: line.lineNumber, title: `Line ${line.lineNumber}`, fact: `${c.label}: ${formatValue(at(r)!.value!, def)}`, criterionId: c.id, summary: lineBrief(line), rank: rankOf.get(line.lineNumber) });
      }
    }
    // A trip that shows it, where one trip can: the trip from their best lines that does worst on it.
    const reading = tripReadingOf(def);
    if (reading && reading !== "none" && reading !== "dates") {
      const shown = [...trips.values()]
        .filter((t) => topTrips.has(t.key))
        .map((t) => ({ t, r: t.results.find((x) => x.criterionId === c.id) }))
        .filter((x) => x.r && x.r.value !== null);
      const span = shown.length ? Math.max(...shown.map((x) => x.r!.utility)) - Math.min(...shown.map((x) => x.r!.utility)) : 0;
      if (span >= MIN_GAP) {
        const worst = shown.sort((a, b) => a.r!.utility - b.r!.utility)[0];
        const trip: Trip | undefined = tripOf.get(worst.t.key);
        const value = tripValueText(worst.r!);
        if (trip && value) add({ kind: "trip", ref: worst.t.key, title: tripLabel(bidPack, trip), fact: `${c.label}: ${value}`, criterionId: c.id, summary: tripHeadline(bidPack, trip) });
      }
    }
  }
  return out;
}

/** How the examples go into the transcript after the question, so the brain reads what the pilot was shown. */
export function examplesTranscript(examples: Pick<QuestionExample, "title" | "fact">[]): string {
  return examples.length ? ` (Examples shown: ${examples.map((e) => `${e.title} — ${e.fact}`).join("; ")}.)` : "";
}
