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
  /** The brain version that read the interview, and whether fleet notes were in its prompt. */
  brainVersion?: number;
  notesUsed?: boolean;
  /** Set by the server when it loads outcomes, never by a browser: which pilot (a one-way hash) and when. */
  pilot?: string;
  at?: string;
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
    ...(params.model.brainVersion ? { brainVersion: params.model.brainVersion } : {}),
    ...(params.model.notesUsed !== undefined ? { notesUsed: params.model.notesUsed } : {}),
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
    ...(Number.isInteger(o.brainVersion) && (o.brainVersion as number) > 0 && (o.brainVersion as number) < 10_000 ? { brainVersion: o.brainVersion as number } : {}),
    ...(typeof o.notesUsed === "boolean" ? { notesUsed: o.notesUsed } : {}),
  };
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export interface BrainLevelStats {
  pilots: number;
  /** Per measure, among priorities pilots confirmed as right at review: how many pilots, the sum of their weights, how many made it a dealbreaker. */
  metrics: Record<string, { pilots: number; wSum: number; hard: number }>;
  /** Per measure: how pilots judged the brain's reading of it at review. */
  review: Record<string, Record<PriorityVerdict, number>>;
  /** Per city: how many pilots graded it, the sum of their grades, and the sum of squares (for how much they agree). */
  cities: Record<string, { n: number; sum: number; sumSq?: number }>;
}

/** Whether a group's notes reach the brain, decided by `decideNotes` on every learning run, and why. */
export interface NotesDecision {
  on: boolean;
  reason: string;
  /** The lines that passed, in the form the brain reads them. */
  lines: string[];
}

export interface BrainFleetModel {
  version: string;
  createdAt: string;
  interviews: number;
  levels: Record<string, BrainLevelStats & { notes?: NotesDecision }>;
}

const emptyLevel = (): BrainLevelStats => ({ pilots: 0, metrics: {}, review: {}, cities: {} });

/**
 * Adds one outcome to a group's statistics. Only what the pilot said counts: a priority is counted when they
 * confirmed it as right at review (never just because the brain read it), verdicts and city grades as given.
 */
function addOutcome(s: BrainLevelStats, o: BrainOutcome): void {
  s.pilots++;
  const confirmed = new Set(o.review.filter((r) => r.verdict === "right").map((r) => r.metric));
  for (const c of o.criteria) {
    if (!confirmed.has(c.metric)) continue;
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
    const city = (s.cities[code] ??= { n: 0, sum: 0, sumSq: 0 });
    city.n++;
    city.sum += score;
    city.sumSq = (city.sumSq ?? 0) + score * score;
  }
}

function statsOf(outcomes: BrainOutcome[]): BrainLevelStats {
  const s = emptyLevel();
  for (const o of outcomes) addOutcome(s, o);
  return s;
}

/** A group needs at least this many different pilots before anything it says is considered at all. */
export const MIN_PILOTS = 10;
/** One-sided 95%: a line is kept only when it's still true at the cautious end of what the group's numbers allow. */
const Z = 1.645;

/** The cautious (lower) end of a share, given how many pilots it rests on (Wilson score bound). */
export function shareLowerBound(hits: number, n: number): number {
  if (n <= 0) return 0;
  const p = hits / n;
  const z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** A city's average grade and how sure the group is of its direction: the cautious end on the side it leans. */
function cityLean(c: { n: number; sum: number; sumSq?: number }): { mean: number; bound: number } {
  const mean = c.sum / c.n;
  const variance = c.n > 1 && c.sumSq !== undefined ? Math.max(0, (c.sumSq - c.n * mean * mean) / (c.n - 1)) : 1;
  const margin = (Z * Math.sqrt(variance)) / Math.sqrt(c.n);
  return { mean, bound: mean > 0 ? mean - margin : mean + margin };
}

/** One thing a group's notes would tell the brain, with the test it must keep passing on new pilots. */
interface NoteLine {
  key: string;
  section: "common" | "corrections" | "cities";
  text: string;
  /** Whether a later set of pilots bears the line out (point estimates: the test set is small). */
  holdsIn: (s: BrainLevelStats) => boolean | null;
}

const label = (metric: string) => METRICS_BY_ID.get(metric)?.label ?? metric;

/** Every line a group's statistics support, each kept only if it passes at the cautious end of its numbers. */
export function noteLines(stats: BrainLevelStats): NoteLine[] {
  const n = stats.pilots;
  const lines: NoteLine[] = [];
  for (const [metric, m] of Object.entries(stats.metrics)) {
    if (shareLowerBound(m.pilots, n) < 0.25) continue;
    const hard = shareLowerBound(m.hard, n) >= 0.2 ? `, a limit for ${Math.round((m.hard / n) * 100)}%` : "";
    lines.push({
      key: `common:${metric}`,
      section: "common",
      text: `${label(metric)} [${metric}] — ${Math.round((m.pilots / n) * 100)}% of them confirmed it, typical weight ${(m.wSum / m.pilots).toFixed(2)}${hard}`,
      holdsIn: (s) => (s.pilots ? (s.metrics[metric]?.pilots ?? 0) / s.pilots >= 0.15 : null),
    });
  }
  for (const [metric, v] of Object.entries(stats.review)) {
    const seen = v.right + v.more + v.less + v.drop;
    if (seen < MIN_PILOTS) continue;
    const said = { less: "should count less than the brain read", more: "should count more", drop: "doesn't matter to them" } as const;
    for (const verdict of ["less", "more", "drop"] as const) {
      if (shareLowerBound(v[verdict], seen) < 0.3) continue;
      lines.push({
        key: `correction:${metric}:${verdict}`,
        section: "corrections",
        text: `${label(metric)}: ${Math.round((v[verdict] / seen) * 100)}% said it ${said[verdict]}`,
        holdsIn: (s) => {
          const t = s.review[metric];
          const tSeen = t ? t.right + t.more + t.less + t.drop : 0;
          return tSeen ? t![verdict] / tSeen >= 0.2 : null;
        },
      });
    }
  }
  for (const [code, c] of Object.entries(stats.cities)) {
    if (c.n < MIN_PILOTS) continue;
    const { mean, bound } = cityLean(c);
    if (Math.abs(mean) < 0.4 || Math.abs(bound) < 0.2 || Math.sign(bound) !== Math.sign(mean)) continue;
    lines.push({
      key: `city:${code}`,
      section: "cities",
      text: `${code} ${mean > 0 ? "liked" : "disliked"} (avg ${mean.toFixed(1)}, ${c.n} pilots)`,
      holdsIn: (s) => {
        const t = s.cities[code];
        return t && t.n >= 2 ? Math.sign(t.sum) === Math.sign(mean) && Math.abs(t.sum / t.n) >= 0.2 : null;
      },
    });
  }
  return lines;
}

/** Notes switch on only when the lines built from a group's earlier pilots also held for this share of its newest. */
export const HOLD_SHARE = 0.7;

/**
 * Whether a group's notes should reach the brain, decided from its own pilots: the lines built from all but the
 * newest fifth must also hold for that newest fifth — would these notes have told the brain the right things about
 * pilots it hadn't seen yet? — and the live guard (`guardNotes`) must not have caught them doing harm.
 */
export function decideNotes(outcomes: BrainOutcome[], guard: { harmful: boolean; reason?: string } = { harmful: false }): NotesDecision {
  const pilots = new Set(outcomes.map((o) => o.pilot ?? "")).size;
  const all = noteLines(statsOf(outcomes));
  if (pilots < MIN_PILOTS) return { on: false, reason: `${pilots} pilots so far — needs ${MIN_PILOTS}`, lines: [] };
  if (guard.harmful) return { on: false, reason: guard.reason ?? "switched off by the live check", lines: [] };
  const sorted = [...outcomes].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const testSize = Math.max(3, Math.round(sorted.length * 0.2));
  const earlier = sorted.slice(0, sorted.length - testSize);
  if (earlier.length < MIN_PILOTS) return { on: false, reason: `waiting for ${MIN_PILOTS + testSize - sorted.length} more pilots to test the notes against`, lines: [] };
  const trained = noteLines(statsOf(earlier));
  if (!trained.length) return { on: false, reason: "nothing the group agrees on firmly enough yet", lines: [] };
  const newest = statsOf(sorted.slice(-testSize));
  const verdicts = trained.map((l) => l.holdsIn(newest)).filter((v): v is boolean => v !== null);
  if (verdicts.length < 2) return { on: false, reason: "the newest pilots don't yet cover enough of what the notes say", lines: [] };
  const held = verdicts.filter(Boolean).length / verdicts.length;
  if (held < HOLD_SHARE) return { on: false, reason: `only ${Math.round(held * 100)}% of the notes held for the newest ${testSize} pilots (needs ${Math.round(HOLD_SHARE * 100)}%)`, lines: [] };
  if (!all.length) return { on: false, reason: "nothing the group agrees on firmly enough yet", lines: [] };
  return { on: true, reason: `${Math.round(held * 100)}% of the notes held for the newest ${testSize} pilots`, lines: all.map((l) => `${l.section}|${l.text}`) };
}

/**
 * The live check once notes are in use: do pilots interviewed with them come out worse? Compared within the group,
 * on how often pilots corrected the brain at review and, once months are flown, how often they say the month went
 * worse than expected. Only a clear difference with enough pilots on both sides counts.
 */
export function guardNotes(outcomes: BrainOutcome[], flown: { notesUsed: boolean; worse: boolean }[] = []): { harmful: boolean; reason?: string } {
  const corrected = (o: BrainOutcome) => o.review.some((r) => r.verdict !== "right");
  const compare = (withBad: number, withN: number, withoutBad: number, withoutN: number) => {
    if (withN < MIN_PILOTS || withoutN < MIN_PILOTS) return null;
    const a = withBad / withN;
    const b = withoutBad / withoutN;
    const pooled = (withBad + withoutBad) / (withN + withoutN);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / withN + 1 / withoutN));
    return a - b > 0.15 && se > 0 && (a - b) / se > Z ? { a, b } : null;
  };
  const withNotes = outcomes.filter((o) => o.notesUsed === true);
  const without = outcomes.filter((o) => o.notesUsed === false);
  const review = compare(withNotes.filter(corrected).length, withNotes.length, without.filter(corrected).length, without.length);
  if (review) return { harmful: true, reason: `pilots interviewed with notes corrected the brain more often (${Math.round(review.a * 100)}% vs ${Math.round(review.b * 100)}%)` };
  const fw = flown.filter((f) => f.notesUsed);
  const fo = flown.filter((f) => !f.notesUsed);
  const months = compare(fw.filter((f) => f.worse).length, fw.length, fo.filter((f) => f.worse).length, fo.length);
  if (months) return { harmful: true, reason: `months ranked with notes went worse than expected more often (${Math.round(months.a * 100)}% vs ${Math.round(months.b * 100)}%)` };
  return { harmful: false };
}

/**
 * Every group's statistics and the decision on its notes. `flownByLevel` carries the real-outcome check-ins per
 * group, for the live guard.
 */
export function computeBrainModel(outcomes: BrainOutcome[], version: string, now: Date, flownByLevel: Record<string, { notesUsed: boolean; worse: boolean }[]> = {}): BrainFleetModel {
  const byLevel: Record<string, BrainOutcome[]> = {};
  for (const o of outcomes) for (const level of cohortLevels(o.cohort)) (byLevel[level] ??= []).push(o);
  const levels: BrainFleetModel["levels"] = {};
  for (const [level, group] of Object.entries(byLevel)) {
    // Flown months carry no commute group: a commute level is judged on its base, fleet and seat's months.
    const flown = flownByLevel[level] ?? flownByLevel[level.replace(/\|(commuter|local|unknown)$/, "")];
    levels[level] = { ...statsOf(group), notes: decideNotes(group, guardNotes(group, flown)) };
  }
  return { version, createdAt: now.toISOString(), interviews: outcomes.length, levels };
}

export interface ResolvedBrainCohort {
  level: string;
  stats: BrainLevelStats & { notes?: NotesDecision };
}

/** The most specific group this pilot belongs to whose notes are switched on. */
export function resolveBrainCohort(model: BrainFleetModel, cohort: Pick<Cohort, "base" | "aircraft" | "seat" | "commute">): ResolvedBrainCohort | null {
  for (const level of [...cohortLevels(cohort)].reverse()) {
    const stats = model.levels[level];
    if (stats && stats.pilots >= MIN_PILOTS && stats.notes?.on) return { level, stats };
  }
  return null;
}

const describeLevel = (level: string) =>
  level === "all"
    ? "FedEx pilots who've taken this interview"
    : level.startsWith("seat:")
      ? `${level.includes("|commuter") ? "commuting " : level.includes("|local") ? "local " : ""}${level.includes("CAP") ? "captains" : "first officers"}`
      : `${level.includes("|commuter") ? "commuting " : level.includes("|local") ? "local " : ""}pilots in this same domicile, fleet and seat`;

/**
 * What pilots like this one tend to care about and how they correct the brain, as a few plain lines for the brain's
 * and the interviewer's prompts — only the lines that passed, and only for a group whose notes are switched on.
 */
export function fleetNotes(resolved: ResolvedBrainCohort | null): string | null {
  const lines = resolved?.stats.notes?.on ? resolved.stats.notes.lines : [];
  if (!resolved || !lines.length) return null;
  const of = (section: string) => lines.filter((l) => l.startsWith(`${section}|`)).map((l) => l.slice(section.length + 1));
  const common = of("common");
  const corrections = of("corrections");
  const cities = of("cities");
  return [
    `From ${resolved.stats.pilots} ${describeLevel(resolved.level)} (anonymous; hints for what to ask about and how to read an ambiguous answer — never facts about this pilot):`,
    common.length ? `Often care about:\n- ${common.join("\n- ")}` : "",
    corrections.length ? `Where pilots corrected the brain's reading at review:\n- ${corrections.join("\n- ")}` : "",
    cities.length ? `City feelings: ${cities.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
