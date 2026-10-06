import { EXPLICIT_WEIGHT_IDS } from "@/lib/interview-engine";
import { MAGNITUDE_ONLY_KEYS } from "@/lib/rank-learning";
import type { Cohort } from "@/lib/learning/cohort";
import type { InterviewQuestion, InterviewTurnRecord, PreferenceFact } from "@/types/interview-session";
import type { ExplicitTargetKey, PreferenceProfile, RangeTarget } from "@/types/preferences";

/**
 * How an answer is counted when pilots are compared: it doesn't matter to
 * them ("zero"), or they lean one way ("pos") or the other ("neg"). Coarse on
 * purpose — two pilots at +60 and +80 on days off want the same thing, and a
 * learned group answer has to be sturdy, not precise to the point.
 */
export type Bucket = "zero" | "pos" | "neg";

/** Below this |weight| (on the -100..100 scale) a preference reads as "doesn't really matter". */
export const ZERO_BAND = 15;

export function bucketOf(dim: string, weight: number): Bucket {
  if (Math.abs(weight) < ZERO_BAND) return "zero";
  if (MAGNITUDE_ONLY_KEYS.has(dim as never)) return "pos";
  return weight > 0 ? "pos" : "neg";
}

/** Where a pilot's final value for a dimension came from — only real answers ("story", "asked", "edited") ever teach the learning. */
export type DimSource = "story" | "asked" | "assumed" | "edited" | "none";

export interface QuestionEvent {
  topic: string;
  kind: InterviewQuestion["kind"];
  /** The dimension a slider/number question was bound to. */
  boundTo?: string;
  skipped: boolean;
  /** Length of what the pilot wrote, rounded to tens — never the words. */
  chars: number;
  /** Facts the answer produced that are still in the final profile. */
  added: number;
  elaboration: boolean;
}

/**
 * Everything the fleet learns from one finished interview — and only that.
 * No pilot's words (not the story, not an answer, not a statement), no name,
 * no city they live in: just which group they bid in, where each preference
 * landed and where it came from, and how each question went. Enough to
 * learn "pilots like this answer landings the same way 85% of the time" and
 * "the rest-and-recovery question usually surfaces something new"; not
 * enough to reconstruct who anyone is.
 */
export interface InterviewOutcome {
  v: 1;
  /** The bid month this interview was for, e.g. "OCT26". */
  month: string;
  cohort: Cohort;
  /** The learned interview model in use, when one was — so its predictions can be checked. */
  modelVersion: string | null;
  story: { provided: boolean; facts: number };
  turns: number;
  wrapped: boolean;
  /** Final explicit preferences, -100..100 (0..100 for magnitude-only ones), with where each came from. */
  dims: Record<string, { w: number; src: DimSource }>;
  /** Learned trip-pattern preferences, -1.5..1.5, only those the pilot actually stated. */
  implicit: Record<string, number>;
  targets: Partial<Record<ExplicitTargetKey, RangeTarget>>;
  cities: { loved: number; avoided: number };
  /** What kinds of hard lines this pilot drew, by kind only ("hotelStandby", "weekly", "dates", "daysOff-min"…). */
  dealbreakers: string[];
  /** What the learned model predicted for each dimension before the pilot answered — checked against the real answer to measure how trustworthy it is. */
  predictions: Record<string, Bucket>;
  questions: QuestionEvent[];
}

function sourceOf(fact: PreferenceFact | undefined): DimSource {
  if (!fact) return "none";
  const s = fact.source;
  if (s.kind === "population-prior") return "assumed";
  if (s.kind === "manual-edit") return "edited";
  if (s.kind === "seed-question" && s.questionKey === "bidding-story") return "story";
  return "asked";
}

function rangeOf(v: number | RangeTarget | undefined): RangeTarget | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? { ideal: v } : v;
}

function dealbreakerKind(f: PreferenceFact): string {
  if (f.recurringWeekday) return "weekly";
  if (f.specificDates?.length) return "dates";
  const m = f.measurable;
  if (!m) return "other";
  if (m.type === "explicit-weight") return m.key;
  if (m.type === "implicit-weight") return m.variableId;
  if (m.type === "explicit-target") return `${m.key}-${m.rangeRole ?? "ideal"}`;
  return "city";
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/** Builds the anonymous record of a finished interview from the pilot's final profile — see `InterviewOutcome`. */
export function buildInterviewOutcome(params: {
  profile: PreferenceProfile;
  transcript: InterviewTurnRecord[];
  cohort: Cohort;
  month: string;
  modelVersion: string | null;
  predictions: Record<string, Bucket>;
  wrapped: boolean;
}): InterviewOutcome {
  const { profile, transcript } = params;
  const facts = profile.discoveredFacts ?? [];

  // The last fact bound to each explicit id is the one that set its final value (facts are applied in order).
  const lastFor = new Map<string, PreferenceFact>();
  for (const f of facts) if (f.measurable?.type === "explicit-weight") lastFor.set(f.measurable.key, f);

  const weights = profile.weights as unknown as Record<string, number>;
  const dims: InterviewOutcome["dims"] = {};
  for (const id of EXPLICIT_WEIGHT_IDS) {
    const fact = lastFor.get(id);
    dims[id] = { w: Math.round(weights[id] ?? 0), src: sourceOf(fact) };
  }

  const implicit: Record<string, number> = {};
  for (const f of facts) {
    if (f.measurable?.type !== "implicit-weight") continue;
    const v = profile.implicitWeights?.[f.measurable.variableId];
    if (typeof v === "number" && f.source.kind !== "population-prior") implicit[f.measurable.variableId] = Math.round(v * 100) / 100;
  }

  const targets: InterviewOutcome["targets"] = {};
  for (const [key, value] of Object.entries(profile.explicitTargets ?? {})) {
    const r = rangeOf(value as number | RangeTarget | undefined);
    if (r) targets[key as ExplicitTargetKey] = r;
  }

  const sentiments = Object.values(profile.cityPreferences ?? {});
  const factsByQuestion = new Map<string, number>();
  for (const f of facts) {
    if (f.source.kind === "adaptive-question") factsByQuestion.set(f.source.questionId, (factsByQuestion.get(f.source.questionId) ?? 0) + 1);
  }

  const questions: QuestionEvent[] = transcript.map((t) => {
    const a = t.answer;
    const text = a.kind === "free-text" ? a.text : "elaboration" in a && a.elaboration ? a.elaboration : "";
    return {
      topic: t.question.topic ?? "other",
      kind: t.question.kind,
      boundTo: "boundTo" in t.question ? t.question.boundTo : undefined,
      skipped: a.kind === "skipped",
      chars: Math.min(2000, roundTo(text.length, 10)),
      added: factsByQuestion.get(t.question.id) ?? 0,
      elaboration: "elaboration" in a && !!a.elaboration?.trim(),
    };
  });

  const storyFacts = facts.filter((f) => f.source.kind === "seed-question" && f.source.questionKey === "bidding-story").length;

  return {
    v: 1,
    month: params.month,
    cohort: params.cohort,
    modelVersion: params.modelVersion,
    story: { provided: storyFacts > 0, facts: storyFacts },
    turns: transcript.length,
    wrapped: params.wrapped,
    dims,
    implicit,
    targets,
    cities: { loved: sentiments.filter((s) => s === "love").length, avoided: sentiments.filter((s) => s === "avoid").length },
    dealbreakers: [...new Set(facts.filter((f) => f.severity === "dealbreaker").map(dealbreakerKind))],
    predictions: params.predictions,
    questions,
  };
}
