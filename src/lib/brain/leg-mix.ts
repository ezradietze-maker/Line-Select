import { tripFactsOf, type PackMetrics } from "@/lib/metrics/compute";
import type { TripFacts } from "@/lib/metrics/trip-facts";
import type { Line, Trip } from "@/types/bidpack";

/**
 * Legs said the way a pilot counts them: by duty. A duty with one leg is a single-leg duty, two legs a two-leg duty,
 * three a three-leg duty. "2 extra legs" beside a priority called "Single-leg duty periods" read as nonsense to the
 * owner (Nov 2026): a single-leg duty can't have extra legs. So wherever the interview shows a line or a trip on one of
 * the legs-per-duty measures, it says the line's duties by their leg count instead: "2 two-leg duty periods, the
 * rest single-leg" against "all single-leg duty periods". Always "duty period", never "duty" or "duties" on its own
 * (the owner, Nov 2026).
 */

/** The measures that are about how many legs a duty has, and read best as the duties themselves. */
export const LEG_MIX_METRICS = new Set(["extraLegs", "dutiesWithManyLegs", "singleLegDutyShare", "avgLegsPerDuty", "maxLegsInADuty"]);

/** The row label for any of them, so the label and the counts beside it say the same thing. */
export const LEG_MIX_LABEL = "Legs per duty period";

const WORDS = ["", "single", "two", "three", "four", "five", "six", "seven", "eight"];
const legWord = (n: number) => `${WORDS[n] ?? n}-leg`;

/** Flying duties by how many legs they operate: "all single-leg duty periods", "1 two-leg duty period and 1 three-leg duty period, the rest single-leg", "no legs flown". */
export function legMixText(facts: TripFacts[]): string | null {
  const counts = new Map<number, number>();
  for (const f of facts) for (const d of f.duties) if (d.operatedLegs > 0) counts.set(d.operatedLegs, (counts.get(d.operatedLegs) ?? 0) + 1);
  // Duty periods with no leg flown in any (hotel standby, deadheads) are said so, not left to the measure's own 0, which
  // reads "all single-leg duty periods": an 11-day hotel-standby line (777 ANC FO, Oct 2026) was shown that way.
  if (!counts.size) return facts.some((f) => f.duties.length) ? "no legs flown" : null;
  const singles = counts.get(1) ?? 0;
  const multi = [...counts.entries()].filter(([legs]) => legs > 1).sort((a, b) => a[0] - b[0]);
  if (!multi.length) return singles === 1 ? "1 single-leg duty period" : "all single-leg duty periods";
  const parts = multi.map(([legs, n]) => `${n} ${legWord(legs)} ${n === 1 ? "duty period" : "duty periods"}`);
  const listed = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  if (!singles) return listed;
  return `${listed}, ${singles === 1 ? "1 single-leg" : "the rest single-leg"}`;
}

/** A line's duties in its bid month, by leg count. */
export function lineLegMix(line: Pick<Line, "id">, pack: PackMetrics): string | null {
  const facts = pack.factsByLine.get(line.id);
  if (!facts || facts.some((f) => f.trip.schedule.length === 0 && f.trip.creditHours > 0)) return null;
  return legMixText(facts);
}

/** One trip's duties by leg count. */
export function tripLegMix(trip: Trip): string | null {
  return trip.schedule.length ? legMixText([tripFactsOf(trip)]) : null;
}
