import { TARGET_SLIDERS } from "@/lib/interview-config";
import type { ExplicitTargetKey, PreferenceWeights } from "@/types/preferences";

const PHRASES: Record<keyof PreferenceWeights, { positive: string; negative: string }> = {
  daysOff: {
    positive: "having plenty of days off",
    negative: "keeping a lean, compact schedule",
  },
  tripLength: {
    positive: "flying longer trips",
    negative: "flying short, quick trips",
  },
  tripCount: {
    positive: "having as few separate trips as possible",
    negative: "not minding lots of separate trips",
  },
  international: {
    positive: "getting international trips",
    negative: "staying mostly domestic",
  },
  region: {
    positive: "Southeast Asia layovers over Northeast Asia",
    negative: "Northeast Asia layovers over Southeast Asia",
  },
  reportTime: {
    positive: "later report times",
    negative: "early report times",
  },
  creditHours: {
    positive: "maximizing credit hours",
    negative: "keeping a lean line",
  },
  deadheadTolerance: {
    positive: "not worrying about deadhead legs",
    negative: "avoiding deadhead legs",
  },
  hotelFood: {
    positive: "having good food within walking distance of your layover hotel",
    negative: "not worrying about food near your layover hotel",
  },
  hotelGym: {
    positive: "having a gym near your layover hotel",
    negative: "not worrying about gym access at your layover hotel",
  },
  hotelGrocery: {
    positive: "having grocery or pharmacy access near your layover hotel",
    negative: "not worrying about grocery access at your layover hotel",
  },
  hotelQuiet: {
    positive: "a quiet, low-noise room on the road",
    negative: "not worrying about room noise",
  },
  hotelQuality: {
    positive: "an overall well-reviewed, comfortable hotel",
    negative: "not worrying much about overall hotel quality",
  },
};

/** Below this, a preference reads as "no strong opinion" and isn't worth mentioning. */
const MEANINGFUL_THRESHOLD = 0.12;

interface RankedPreference {
  key: keyof PreferenceWeights;
  importance: number;
  phrase: string;
}

/**
 * Ranks a pilot's stated preferences by how strongly they feel about each,
 * returning plain-English phrases in priority order — the basis for both
 * the "here's what we heard" summary sentence and its ordering.
 */
export function rankPreferences(
  weights: PreferenceWeights,
  explicitTargets: Partial<Record<ExplicitTargetKey, number>>
): RankedPreference[] {
  const keys = Object.keys(weights) as (keyof PreferenceWeights)[];

  const ranked = keys.map((key): RankedPreference => {
    const weight = weights[key];
    const explicitKey = key as ExplicitTargetKey;
    const explicitValue =
      key === "daysOff" || key === "creditHours" || key === "tripCount"
        ? explicitTargets[explicitKey]
        : undefined;
    const hasExplicit = explicitValue !== undefined;
    const importance = Math.max(Math.min(1, Math.abs(weight) / 100), hasExplicit ? 0.5 : 0);

    let phrase: string;
    if (hasExplicit) {
      const config = TARGET_SLIDERS.find((t) => t.key === explicitKey);
      const unit = config
        ? explicitValue === 1
          ? config.unitSingular
          : config.unitPlural
        : "";
      phrase = `wanting close to ${config?.formatValue(explicitValue) ?? explicitValue} ${unit}`.trim();
    } else {
      phrase = weight >= 0 ? PHRASES[key].positive : PHRASES[key].negative;
    }

    return { key, importance, phrase };
  });

  return ranked
    .filter((r) => r.importance > MEANINGFUL_THRESHOLD)
    .sort((a, b) => b.importance - a.importance);
}

/** "You care most about X, then Y, then Z." — the top-line summary sentence. */
export function summarizePreferencesSentence(
  weights: PreferenceWeights,
  explicitTargets: Partial<Record<ExplicitTargetKey, number>>
): string {
  const phrases = rankPreferences(weights, explicitTargets)
    .slice(0, 3)
    .map((r) => r.phrase);

  if (phrases.length === 0) {
    return "You didn't set any strong preferences, so lines will be ranked on overall balance.";
  }
  if (phrases.length === 1) {
    return `You care most about ${phrases[0]}.`;
  }
  const last = phrases[phrases.length - 1];
  const rest = phrases.slice(0, -1);
  return `You care most about ${rest.join(", then ")}, then ${last}.`;
}
