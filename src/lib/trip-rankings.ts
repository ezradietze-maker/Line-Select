import { satisfactionScale } from "@/lib/satisfaction-index";
import { HARD_LIMIT_CAP } from "@/lib/scoring-v2/score";
import { tripKey, type TripScore } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/** One trip of the pack on Trip Rankings, with its score and the line that flies it. */
export interface RankedTrip {
  key: string;
  trip: Trip;
  /** The line that flies it. */
  line: Line;
  /** Its place among every trip in the pack, 1 the best, whichever of them are listed. */
  rank: number;
  /** The trip's score for this pilot, with `score` as the Trip Index (`rankTrips`). */
  score: TripScore;
}

/**
 * Every trip the pack's lines fly, best first, in the order the trips' own scores put them (`scoreTripsV2`, the scores
 * My Rankings shows inside each line). What a pilot reads is the Trip Index: the same scores spread over 1–100 for this
 * pack, as lines are (`satisfactionScale`) — the best trip in the high 90s, one decimal. On the line scale My Rankings
 * puts trips on, the ex-pilot's 566 trips (777 Captain, Oct 2026) read only 180 different scores, 27 of them alike at
 * once: that scale runs flat where several lines' trips average about the same. Spread from the trips' own, unrounded
 * scores, they read 306 different ones, and trips still alike are next to identical. Trips with nothing to measure are
 * left out.
 *
 * `onLines` lists only the trips those lines fly, each on one of them, for a pilot who sees only their top lines: the
 * scale and the places stay the pack's, so a trip reads the same score and place a member sees.
 */
export function rankTrips(bidPack: BidPack, scores: ReadonlyMap<string, TripScore>, onLines?: ReadonlySet<string>): RankedTrip[] {
  const out: { key: string; trip: Trip; line: Line; shownOn?: Line; score: TripScore; fit: number }[] = [];
  const byKey = new Map<string, (typeof out)[number]>();
  for (const line of bidPack.lines) {
    for (const trip of line.trips) {
      const key = tripKey(trip);
      const score = scores.get(key);
      if (!score) continue;
      const seen = byKey.get(key);
      // A trip two lines fly is listed once; with `onLines`, on the first of those lines that flies it.
      if (seen) {
        if (onLines?.has(line.id) && !seen.shownOn) seen.shownOn = line;
        continue;
      }
      // Unrounded, so trips a hair apart stay apart; a limit holds a trip down as it does in its score.
      const entry = { key, trip, line, shownOn: onLines?.has(line.id) ? line : undefined, score, fit: Math.max(0, score.violations.length ? score.uncapped * HARD_LIMIT_CAP : score.uncapped) };
      byKey.set(key, entry);
      out.push(entry);
    }
  }
  const scale = satisfactionScale(out.map((t) => t.fit));
  return out
    .sort((a, b) => b.fit - a.fit || a.line.lineNumber.localeCompare(b.line.lineNumber) || (a.trip.startDayIndex ?? 0) - (b.trip.startDayIndex ?? 0))
    .flatMap(({ key, trip, line, shownOn, score, fit }, i) =>
      onLines && !shownOn ? [] : [{ key, trip, line: shownOn ?? line, rank: i + 1, score: { ...score, score: scale(fit) } }]
    );
}
