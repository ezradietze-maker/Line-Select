import { TRADEOFF_QUESTIONS } from "@/lib/interview-config";
import {
  DEFAULT_WEIGHTS,
  type CitySentiment,
  type ExplicitTargetKey,
  type PreferenceProfile,
  type PreferenceWeights,
  type TradeoffAnswer,
} from "@/types/preferences";

/** How far a fully-committed trade-off answer can nudge a slider weight. */
const TRADEOFF_NUDGE_MAGNITUDE = 20;

/**
 * Trade-off answers refine slider-derived weights: each answer nudges the
 * weight for its dimension by up to +/-TRADEOFF_NUDGE_MAGNITUDE, scaled by
 * how decisively the pilot picked a side. This lets the deeper round add
 * precision beyond what a single slider position can express, without
 * letting one trade-off answer override a strongly-held slider preference.
 */
export function applyTradeoffs(
  baseWeights: PreferenceWeights,
  answers: TradeoffAnswer[]
): PreferenceWeights {
  const weights = { ...baseWeights };

  for (const answer of answers) {
    const config = TRADEOFF_QUESTIONS.find((q) => q.id === answer.id);
    if (!config) continue;
    // answer.value is -1 for option A / +1 for option B, purely a UI choice.
    // Flip it so the nudge always points toward whichever option is this
    // dimension's "positive" (highLabel) direction, regardless of which
    // side of the UI that option happened to be rendered on.
    const directionMultiplier = config.positiveOption === "A" ? -1 : 1;
    const nudge = answer.value * directionMultiplier * TRADEOFF_NUDGE_MAGNITUDE;
    const current = weights[config.dimension];
    weights[config.dimension] = Math.min(
      100,
      Math.max(-100, current + nudge)
    );
  }

  return weights;
}

export function buildProfile(
  sliderWeights: PreferenceWeights,
  deepRoundCompleted: boolean,
  tradeoffAnswers: TradeoffAnswer[],
  explicitTargets: Partial<Record<ExplicitTargetKey, number>> = {},
  isCommuter: boolean | null = null,
  cityPreferences: Record<string, CitySentiment> = {},
  hasCrashPad: boolean | null = null
): PreferenceProfile {
  const weights = deepRoundCompleted
    ? applyTradeoffs(sliderWeights, tradeoffAnswers)
    : sliderWeights;

  return {
    weights,
    deepRoundCompleted,
    tradeoffAnswers,
    // Not gated on deepRoundCompleted: nights-home/departures targets and
    // city preferences are now collected in the quick round, so they must
    // survive a pilot skipping the optional deep round. Anything that's
    // genuinely deep-only (creditHours/tripCount targets) simply stays
    // unset in these params if the pilot never reached that phase.
    explicitTargets,
    isCommuter,
    cityPreferences,
    hasCrashPad,
    completedAt: new Date().toISOString(),
    implicitWeights: {},
    implicitConfidence: {},
  };
}

export function emptyWeights(): PreferenceWeights {
  return { ...DEFAULT_WEIGHTS };
}

const CITY_SENTIMENT_CYCLE: (CitySentiment | undefined)[] = [undefined, "love", "avoid"];

/**
 * Advances one city's sentiment: no opinion -> love -> avoid -> no opinion.
 * A pure function of the current map so it's safe to call from a functional
 * setState update — reading the map from a stale prop/closure instead would
 * lose a step when two taps land before a re-render (e.g. a fast double-tap
 * on mobile).
 */
export function cycleCitySentiment(
  current: Record<string, CitySentiment>,
  code: string
): Record<string, CitySentiment> {
  const currentIndex = CITY_SENTIMENT_CYCLE.indexOf(current[code]);
  const next = CITY_SENTIMENT_CYCLE[(currentIndex + 1) % CITY_SENTIMENT_CYCLE.length];
  const updated = { ...current };
  if (next) {
    updated[code] = next;
  } else {
    delete updated[code];
  }
  return updated;
}
