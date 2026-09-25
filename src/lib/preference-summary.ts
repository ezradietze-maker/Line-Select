import { ALL_TARGET_CONFIGS, formatExplicitTarget } from "@/lib/interview-config";
import type { ExplicitTargetKey, PreferenceWeights, RangeTarget } from "@/types/preferences";

export const PHRASES: Record<keyof PreferenceWeights, { positive: string; negative: string }> = {
  daysOff: {
    positive: "having plenty of days off",
    negative: "keeping a lean, compact schedule",
  },
  tripLength: {
    positive: "flying longer trips",
    negative: "flying short, quick trips",
  },
  international: {
    positive: "getting international trips",
    negative: "staying mostly domestic",
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
  departures: {
    positive: "keeping the number of separate departures close to what you pinned",
    negative: "not worrying about the number of separate departures",
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
  circadianHealth: {
    positive: "protecting your sleep and body clock, even at a cost elsewhere",
    negative: "not worrying much about circadian disruption",
  },
  landings: {
    positive: "getting more landings in for proficiency and comfort",
    negative: "keeping landings down for fatigue management",
  },
  hotelStandby: {
    positive: "hotel standby days — paid to sit at the hotel rather than fly",
    negative: "avoiding hotel standby",
  },
  // riskTolerance/adminEffortAppetite are strategy-board inputs, not line
  // preferences — scoring.ts never reads them, so they're deliberately
  // filtered out of rankPreferences below before this phrasing is ever
  // reached. Entries exist only to satisfy this Record's exhaustiveness.
  riskTolerance: {
    positive: "an aggressive, high-upside bidding approach",
    negative: "the safest, most guaranteed pick available",
  },
  adminEffortAppetite: {
    positive: "putting in real effort — trades, grievances, re-bids — for a better outcome",
    negative: "avoiding extra paperwork or process work",
  },
};

/** Strategy-board-only inputs — see their own doc comments in `types/preferences.ts` — deliberately excluded from any "what's driving your ranking" narrative, since neither one actually moves a line's score. */
const NON_LINE_PREFERENCE_KEYS = new Set<keyof PreferenceWeights>(["riskTolerance", "adminEffortAppetite"]);

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
  explicitTargets: Partial<Record<ExplicitTargetKey, number | RangeTarget>>
): RankedPreference[] {
  const keys = (Object.keys(weights) as (keyof PreferenceWeights)[]).filter((k) => !NON_LINE_PREFERENCE_KEYS.has(k));

  const ranked = keys.map((key): RankedPreference => {
    const weight = weights[key];
    const explicitKey = key as ExplicitTargetKey;
    const explicitValue =
      key === "daysOff" || key === "creditHours" || key === "departures"
        ? explicitTargets[explicitKey]
        : undefined;
    const hasExplicit = explicitValue !== undefined;
    const importance = Math.max(Math.min(1, Math.abs(weight) / 100), hasExplicit ? 0.5 : 0);

    let phrase: string;
    if (hasExplicit) {
      const config = ALL_TARGET_CONFIGS.find((t) => t.key === explicitKey);
      phrase = config ? `wanting ${formatExplicitTarget(config, explicitValue!)}` : "";
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
  explicitTargets: Partial<Record<ExplicitTargetKey, number | RangeTarget>>
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
