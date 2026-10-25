import type { MetricParams } from "@/lib/metrics/catalog";

/**
 * The pilot brain: one structured model of what a pilot cares about, built
 * by the interview from his own words and scored against every line. Each
 * criterion is one thing he cares about, measured in real units by the
 * metric library (`lib/metrics/`), with the shape of how he values it and
 * how much it matters relative to everything else.
 */

/** How value changes with the measurement, in the metric's real units. */
export type CriterionShape =
  /** Higher is better; past `enoughAt` more stops adding anything. */
  | { kind: "more"; enoughAt?: number }
  /** Lower is better; at or below `fineAt` it's as good as it gets, at or above `worstAt` as bad. */
  | { kind: "less"; fineAt?: number; worstAt?: number }
  /** A sweet spot: best at `ideal`, falling off over `tolerance` either side. */
  | { kind: "target"; ideal: number; tolerance: number }
  /** Anywhere inside is fine; outside falls off. */
  | { kind: "range"; min?: number; max?: number }
  /** Each occurrence costs `costEach` of the criterion's value (e.g. each three-leg duty). */
  | { kind: "perOccurrence"; costEach: number };

export type CriterionTier = "must" | "high" | "medium" | "low";

export interface CriterionEvidence {
  quote: string;
  /** Interview turn it came from; 0 = the opening story. */
  turn: number;
}

export interface Criterion {
  id: string;
  /** Metric library id (see `METRICS`). */
  metric: string;
  params?: MetricParams;
  shape: CriterionShape;
  tier: CriterionTier;
  /** Relative weight, 0–1. Set from the tier, the pilot's own ordering, and line-versus-line choices. */
  weight: number;
  /** How sure the interview is that this criterion is right, 0–1. */
  confidence: number;
  /** In the pilot's terms: "Avoid three-leg duties". */
  label: string;
  evidence: CriterionEvidence[];
  status: "settled" | "open" | "conflict";
  /** A line he would not bid: crossing this caps the line's score. */
  hardLimit?: { op: "max" | "min"; value: number };
}

/** Something the pilot raised that the interview still wants to understand — the interview's agenda. */
export interface PilotThread {
  id: string;
  topic: string;
  /** Why it's worth asking about. */
  why: string;
  /** 0–1: how much getting this right would change his ranking. */
  priority: number;
  status: "open" | "settled" | "parked";
  criteria: string[];
  timesAsked: number;
}

export interface PilotHome {
  /** Airports he flies from, home first. */
  airports: string[];
  commuter: boolean;
  /** Hours he arrives at base ahead of a report. */
  commuteBufferHours?: number;
  /** Hours ahead of the first operated leg he wants when deviating onto a front-end deadhead. */
  frontBufferHours?: number;
  /** Rest he wants after the last operated leg before heading home. */
  backRestHours?: number;
  /** Minimum backup flights he wants when deviating. */
  backupFlights?: number;
  /** Hours at home that make going home between two trips worth it; under it, trips flown around the gap are one departure (default 24). */
  minHomeHours?: number;
  /** A crash pad or apartment at base: nights there cost him nothing extra. */
  hasCrashPad?: boolean;
}

export interface PilotModel {
  version: 2;
  home: PilotHome | null;
  criteria: Criterion[];
  threads: PilotThread[];
  /** Things he cares about that a bid pack can't show — kept, and said back honestly. */
  notMeasurable: { statement: string; why: string }[];
  /** A short running summary of who this pilot is — the interview's memory. */
  synopsis: string;
  /** How many interview exchanges this reading was built from — the next reading builds on it and knows what's new. */
  readUpTo?: number;
  /**
   * How much more or less each criterion counts on a single trip than on a line, by criterion id (1 = the same) —
   * learned from the pilot's own trip choices (see `fitTripWeights`). Lines never read it.
   */
  tripWeights?: Record<string, number>;
  /**
   * Facts about the pilot read from their words by a second call beside the brain's (see `readPilotFacts`): the
   * values given, by fact id, and their own words for each.
   */
  facts?: { values: Record<string, number | boolean>; evidence: { fact: string; quote: string; turn: number }[] };
}

export const TIER_WEIGHT: Record<CriterionTier, number> = { must: 1, high: 0.7, medium: 0.4, low: 0.15 };

/** A line-versus-line choice the pilot made in the interview — the most direct evidence of how they really trade. */
export interface LineChoice {
  /** The line they'd rather bid. */
  preferred: string;
  /** The line they passed over. */
  other: string;
  /** "Strongly" when they said it was an easy call; "slightly" when it was close. */
  strength: "slightly" | "strongly";
  /**
   * The pilot put the line there themselves (a drag on their results), rather than answering a question — counted in
   * full however far it is from the model's view, where a close call in the interview is capped (see `fit-choices.ts`).
   */
  direct?: boolean;
  why?: string;
}

/** A trip-versus-trip choice from the interview: which of two real trips the pilot would rather fly. Trips by `tripKey`. */
export interface TripChoice {
  preferred: string;
  other: string;
  strength: "slightly" | "strongly";
  why?: string;
}
