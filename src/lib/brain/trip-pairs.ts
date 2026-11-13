import { tripHeadline } from "@/lib/brain/line-text";
import { namedDomicile } from "@/lib/domicile-name";
import { plainBetter } from "@/lib/brain/plain-features";
import { tripLabel } from "@/lib/brain/trip-sort";
import type { PackMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, tripKey, tripValueText, type TripScore } from "@/lib/scoring-v2/trip-score";
import { tripStandbyDays } from "@/lib/standby";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Two real trips from the pilot's own best lines that pull their priorities against each other: "which would you rather
 * fly?" The ex-pilot asked for this twice — "it would be way more helpful for both of us if you gave me actual trips to
 * choose between" — and his answers to five of them (Oct 21) were among the richest he gave: "West coast double
 * deadhead! HNL layover! One-leg trip!" The trip grades at the end of the interview cover many trips at once; a trip
 * choice in the middle of it weighs one trip-level trade (a deadhead from home against a layover he loves) and gets
 * the why behind it.
 */

export interface TripPairDifference {
  label: string;
  a: string;
  b: string;
  better: "a" | "b";
  /** How a pilot would say the better trip beats the other, without the measurement (see `plain-features.ts`). */
  plain?: string;
}

export interface TripPairCandidate {
  index: number;
  /** The trips, by `tripKey`. */
  a: string;
  b: string;
  /** "Trip #50 · Oct 1". */
  labelA: string;
  labelB: string;
  /** Each trip's strongest point, by metric, sorted — so the same trade isn't asked twice. */
  trade: string;
  /** What each trip is better on. */
  tension: string;
  differences: TripPairDifference[];
  summaryA: string;
  summaryB: string;
}

/** The pilot's best lines, whose trips are the candidates. */
const FROM_TOP_LINES = 20;
/** At most this many trips are paired up. */
const MAX_CANDIDATES = 40;
/** A difference this big (utility × weight) is one the pilot would notice. */
const NOTICEABLE = 0.06;
/** Score points over which a close call fades. */
const CLOSE_CALL_POINTS = 8;

/** How a trip choice is recorded in the transcript: "… [Trip #50 · Oct 1 {50@3} vs Trip #104 · Oct 2 {104@4}: …]". */
export const TRIP_PAIR_QUESTION = / \[Trip #[^\]{]+\{[^}]+\} vs Trip #[^\]{]+\{[^}]+\}:/;

export function tripPairTranscript(prompt: string, p: Pick<TripPairCandidate, "a" | "b" | "labelA" | "labelB" | "tension">): string {
  return `${prompt} [${p.labelA} {${p.a}} vs ${p.labelB} {${p.b}}: ${p.tension}]`;
}

/** The trip pairs already put to the pilot, read back from the transcript. */
export function askedTripPairs(exchanges: { question: string }[]): Set<string> {
  const out = new Set<string>();
  for (const e of exchanges) for (const m of e.question.matchAll(/\{([^}]+)\} vs [^{]+\{([^}]+)\}/g)) out.add(`${m[1]}|${m[2]}`).add(`${m[2]}|${m[1]}`);
  return out;
}

/** A trip that's mostly hotel standby isn't what a pilot means by a trip (see `question-examples.ts`). */
const mostlyStandby = (t: Trip) => tripStandbyDays(t) * 2 >= Math.max(1, t.days);

function differencesOf(a: TripScore, b: TripScore): (TripPairDifference & { pull: number; metric: string })[] {
  return a.results
    .map((ra) => ({ ra, rb: b.results.find((x) => x.criterionId === ra.criterionId) }))
    .filter((x): x is { ra: typeof x.ra; rb: NonNullable<typeof x.rb> } => !!x.rb && x.ra.value !== null && x.rb.value !== null)
    .map(({ ra, rb }) => ({ label: ra.label, metric: ra.metric, a: tripValueText(ra) ?? "—", b: tripValueText(rb) ?? "—", pull: (ra.utility - rb.utility) * ra.weight, better: (ra.utility >= rb.utility ? "a" : "b") as "a" | "b" }))
    .filter((d) => Math.abs(d.pull) >= NOTICEABLE)
    .sort((x, y) => Math.abs(y.pull) - Math.abs(x.pull));
}

/**
 * Up to `limit` trip pairs worth asking about: two trips from the pilot's best lines, close overall, each clearly better
 * on something they care about, never two dates of the same trip, never a pair or a trade already asked.
 */
export function pickTripPairs(bidPack: BidPack, model: PilotModel, pack: PackMetrics, asked: Set<string>, pastTrades: string[] = [], limit = 2): TripPairCandidate[] {
  if (model.criteria.length < 2) return [];
  const scores = scoreTripsV2(bidPack, model, { pack });
  const lines = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score).slice(0, FROM_TOP_LINES);
  const lineOf = new Map(bidPack.lines.map((l) => [l.lineNumber, l]));
  const seen = new Set<string>();
  const trips: Trip[] = [];
  for (const r of lines)
    for (const t of lineOf.get(r.lineNumber)?.trips ?? []) {
      if (seen.has(t.id) || mostlyStandby(t) || !scores.get(tripKey(t)) || trips.length >= MAX_CANDIDATES) continue;
      seen.add(t.id);
      trips.push(t);
    }

  const ranked: { a: Trip; b: Trip; worth: number; trade: string; diffs: ReturnType<typeof differencesOf> }[] = [];
  for (let i = 0; i < trips.length; i++)
    for (let j = i + 1; j < trips.length; j++) {
      const [a, b] = [trips[i], trips[j]];
      if (asked.has(`${tripKey(a)}|${tripKey(b)}`)) continue;
      const [sa, sb] = [scores.get(tripKey(a))!, scores.get(tripKey(b))!];
      const diffs = differencesOf(sa, sb);
      const forA = diffs.find((d) => d.pull > 0);
      const forB = diffs.find((d) => d.pull < 0);
      if (!forA || !forB) continue;
      const trade = [forA.metric, forB.metric].sort().join("|");
      if (pastTrades.includes(trade)) continue;
      const worth = (Math.abs(forA.pull) + Math.abs(forB.pull)) / (1 + Math.abs(sa.score - sb.score) / CLOSE_CALL_POINTS);
      ranked.push({ a, b, worth, trade, diffs });
    }
  ranked.sort((x, y) => y.worth - x.worth);

  const out: TripPairCandidate[] = [];
  const trades = new Set<string>();
  for (const p of ranked) {
    if (out.length >= limit) break;
    if (trades.has(p.trade)) continue;
    trades.add(p.trade);
    const [labelA, labelB] = [tripLabel(bidPack, p.a), tripLabel(bidPack, p.b)];
    const shown = p.diffs.slice(0, 5);
    const named = (text: string) => namedDomicile(text, bidPack.base);
    const better = (side: "a" | "b") => shown.filter((d) => d.better === side).map((d) => named(d.label));
    out.push({
      index: out.length,
      a: tripKey(p.a),
      b: tripKey(p.b),
      labelA,
      labelB,
      trade: p.trade,
      tension: `${labelA} is better on ${better("a").join("; ")}. ${labelB} on ${better("b").join("; ")}`,
      differences: shown.map(({ label, a, b, better, metric }) => {
        const plain = plainBetter(metric);
        return { label: named(label), a: named(a), b: named(b), better, ...(plain ? { plain } : {}) };
      }),
      summaryA: tripHeadline(bidPack, p.a),
      summaryB: tripHeadline(bidPack, p.b),
    });
  }
  return out;
}
