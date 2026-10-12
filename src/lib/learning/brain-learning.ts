import { cohortLevels, type Cohort } from "@/lib/learning/cohort";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import type { PriorityVerdict } from "@/lib/brain/review";
import type { PilotModel } from "@/types/pilot-model";

/**
 * What the pilot brain learns from every pilot who takes the story-driven
 * interview, so the next pilot like them gets a sharper one: which
 * priorities pilots in their group end up with and how strongly, how they
 * feel about the group's layover cities, and where pilots keep correcting
 * the brain's reading at review.
 *
 * Nothing here is a pilot's words. An outcome is the shape of the finished
 * model (which measures, how much each counted, whether it was a dealbreaker),
 * city grades, and the review verdicts — tied to the same coarse group every
 * bid pack prints (base, fleet, seat, commuter or not).
 *
 * The brain reads what's learned as hints only — what to ask about, and how
 * to read an ambiguous answer — never as a fact about the pilot in front of it.
 */

export interface BrainOutcome {
  v: 2;
  month: string;
  cohort: Cohort;
  checkIn: boolean;
  questions: number;
  choices: number;
  /** The final model: each measure, its weight relative to the strongest (0–1), and whether it was a dealbreaker. */
  criteria: { metric: string; w: number; hard: boolean }[];
  /** City grades, −1 … +1, for the cities the pilot rated. */
  cities: Record<string, number>;
  /** How the pilot judged each priority at review, by measure. */
  review: { metric: string; verdict: PriorityVerdict }[];
}

export function buildBrainOutcome(params: {
  month: string;
  cohort: Cohort;
  checkIn: boolean;
  questions: number;
  choices: number;
  model: PilotModel;
  cityScores: Record<string, number>;
  review: { metric: string; verdict: PriorityVerdict }[];
}): BrainOutcome {
  // One entry per measure: a pilot with two criteria on the same measure counts once, at the stronger.
  const byMetric = new Map<string, { w: number; hard: boolean }>();
  for (const c of params.model.criteria) {
    const prev = byMetric.get(c.metric);
    byMetric.set(c.metric, { w: Math.max(prev?.w ?? 0, c.weight), hard: (prev?.hard ?? false) || !!c.hardLimit });
  }
  return {
    v: 2,
    month: params.month,
    cohort: params.cohort,
    checkIn: params.checkIn,
    questions: params.questions,
    choices: params.choices,
    criteria: [...byMetric].map(([metric, x]) => ({ metric, w: Math.round(x.w * 100) / 100, hard: x.hard })),
    cities: Object.fromEntries(Object.entries(params.cityScores).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    review: params.review,
  };
}

const VERDICTS: PriorityVerdict[] = ["right", "more", "less", "drop"];
const isCode = (s: unknown): s is string => typeof s === "string" && /^[A-Z0-9]{2,4}$/.test(s);

/** Accepts only a well-formed outcome with bounded, known contents — it comes from a browser. */
export function parseBrainOutcome(raw: unknown): BrainOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const c = o.cohort as Record<string, unknown> | undefined;
  if (o.v !== 2 || typeof o.month !== "string" || o.month.length > 8 || !c || !isCode(c.base) || typeof c.aircraft !== "string" || c.aircraft.length > 8 || typeof c.seat !== "string" || c.seat.length > 4) return null;
  if (!["commuter", "local", "unknown"].includes(c.commute as string) || !["senior", "middle", "junior", "unknown"].includes(c.seniority as string)) return null;
  if (!Array.isArray(o.criteria) || o.criteria.length > 40 || !Array.isArray(o.review) || o.review.length > 40 || typeof o.cities !== "object" || o.cities === null) return null;
  const criteria = o.criteria.filter((x): x is { metric: string; w: number; hard: boolean } => typeof x?.metric === "string" && METRICS_BY_ID.has(x.metric) && typeof x.w === "number" && x.w >= 0 && x.w <= 1 && typeof x.hard === "boolean");
  const review = o.review.filter((x): x is { metric: string; verdict: PriorityVerdict } => typeof x?.metric === "string" && METRICS_BY_ID.has(x.metric) && VERDICTS.includes(x.verdict));
  const cities = Object.fromEntries(Object.entries(o.cities as Record<string, unknown>).filter(([k, v]) => isCode(k) && typeof v === "number" && v >= -1 && v <= 1).slice(0, 120)) as Record<string, number>;
  return {
    v: 2,
    month: o.month,
    cohort: { base: c.base as string, aircraft: c.aircraft as string, seat: c.seat as string, commute: c.commute as Cohort["commute"], seniority: c.seniority as Cohort["seniority"] },
    checkIn: o.checkIn === true,
    questions: typeof o.questions === "number" ? Math.max(0, Math.min(60, Math.round(o.questions))) : 0,
    choices: typeof o.choices === "number" ? Math.max(0, Math.min(200, Math.round(o.choices))) : 0,
    criteria,
    cities,
    review,
  };
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export interface BrainLevelStats {
  pilots: number;
  /** Per measure: how many pilots ended up with it, the sum of its weights, how many made it a dealbreaker. */
  metrics: Record<string, { pilots: number; wSum: number; hard: number }>;
  /** Per measure: how pilots judged the brain's reading of it at review. */
  review: Record<string, Record<PriorityVerdict, number>>;
  /** Per city: how many pilots graded it and the sum of their grades. */
  cities: Record<string, { n: number; sum: number }>;
}

export interface BrainFleetModel {
  version: string;
  createdAt: string;
  interviews: number;
  levels: Record<string, BrainLevelStats>;
}

const emptyLevel = (): BrainLevelStats => ({ pilots: 0, metrics: {}, review: {}, cities: {} });

export function computeBrainModel(outcomes: BrainOutcome[], version: string, now: Date): BrainFleetModel {
  const levels: Record<string, BrainLevelStats> = {};
  for (const o of outcomes) {
    for (const level of cohortLevels(o.cohort)) {
      const s = (levels[level] ??= emptyLevel());
      s.pilots++;
      for (const c of o.criteria) {
        const m = (s.metrics[c.metric] ??= { pilots: 0, wSum: 0, hard: 0 });
        m.pilots++;
        m.wSum += c.w;
        if (c.hard) m.hard++;
      }
      for (const r of o.review) {
        const v = (s.review[r.metric] ??= { right: 0, more: 0, less: 0, drop: 0 });
        v[r.verdict]++;
      }
      for (const [code, score] of Object.entries(o.cities)) {
        const city = (s.cities[code] ??= { n: 0, sum: 0 });
        city.n++;
        city.sum += score;
      }
    }
  }
  return { version, createdAt: now.toISOString(), interviews: outcomes.length, levels };
}

/** A group needs at least this many pilots before what it says is worth passing on. */
export const MIN_PILOTS = 5;

export interface ResolvedBrainCohort {
  level: string;
  stats: BrainLevelStats;
}

/** The most specific group this pilot belongs to that has enough pilots in it. */
export function resolveBrainCohort(model: BrainFleetModel, cohort: Pick<Cohort, "base" | "aircraft" | "seat" | "commute">): ResolvedBrainCohort | null {
  for (const level of [...cohortLevels(cohort)].reverse()) {
    const stats = model.levels[level];
    if (stats && stats.pilots >= MIN_PILOTS) return { level, stats };
  }
  return null;
}

const describeLevel = (level: string) =>
  level === "all"
    ? "FedEx pilots who've taken this interview"
    : level.startsWith("seat:")
      ? `${level.includes("|commuter") ? "commuting " : level.includes("|local") ? "local " : ""}${level.includes("CAP") ? "captains" : "first officers"}`
      : `${level.includes("|commuter") ? "commuting " : level.includes("|local") ? "local " : ""}pilots in this same base, fleet and seat`;

/**
 * What pilots like this one tend to care about and how they correct the
 * brain, as a few plain lines for the brain's and the interviewer's prompts.
 * Null until a group has enough pilots to say anything.
 */
export function fleetNotes(resolved: ResolvedBrainCohort | null): string | null {
  if (!resolved) return null;
  const { stats, level } = resolved;
  const n = stats.pilots;
  const label = (metric: string) => METRICS_BY_ID.get(metric)?.label ?? metric;
  const common = Object.entries(stats.metrics)
    .filter(([, m]) => m.pilots / n >= 0.25)
    .sort((a, b) => b[1].pilots - a[1].pilots)
    .slice(0, 8)
    .map(([metric, m]) => `${label(metric)} [${metric}] — ${Math.round((m.pilots / n) * 100)}% of them, typical weight ${(m.wSum / m.pilots).toFixed(2)}${m.hard / n >= 0.2 ? `, a dealbreaker for ${Math.round((m.hard / n) * 100)}%` : ""}`);
  const corrections = Object.entries(stats.review)
    .map(([metric, v]) => ({ metric, seen: v.right + v.more + v.less + v.drop, ...v }))
    .filter((x) => x.seen >= MIN_PILOTS)
    .flatMap((x) => {
      const out: string[] = [];
      if (x.less / x.seen >= 0.3) out.push(`${label(x.metric)}: ${Math.round((x.less / x.seen) * 100)}% said it should count less than the brain read`);
      if (x.more / x.seen >= 0.3) out.push(`${label(x.metric)}: ${Math.round((x.more / x.seen) * 100)}% said it should count more`);
      if (x.drop / x.seen >= 0.3) out.push(`${label(x.metric)}: ${Math.round((x.drop / x.seen) * 100)}% said it doesn't matter to them`);
      return out;
    });
  const cities = Object.entries(stats.cities)
    .filter(([, c]) => c.n >= MIN_PILOTS && Math.abs(c.sum / c.n) >= 0.4)
    .sort((a, b) => Math.abs(b[1].sum / b[1].n) - Math.abs(a[1].sum / a[1].n))
    .slice(0, 8)
    .map(([code, c]) => `${code} ${c.sum / c.n > 0 ? "liked" : "disliked"} (avg ${(c.sum / c.n).toFixed(1)}, ${c.n} pilots)`);
  if (!common.length && !corrections.length && !cities.length) return null;
  return [
    `From ${n} ${describeLevel(level)} (anonymous; hints for what to ask about and how to read an ambiguous answer — never facts about this pilot):`,
    common.length ? `Often care about:\n- ${common.join("\n- ")}` : "",
    corrections.length ? `Where pilots corrected the brain's reading at review:\n- ${corrections.join("\n- ")}` : "",
    cities.length ? `City feelings: ${cities.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
