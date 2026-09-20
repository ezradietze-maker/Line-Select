import type {
  DeepSliderKey,
  ExplicitTargetKey,
  PreferenceWeights,
  QuickQuestionKey,
  RangeTarget,
} from "@/types/preferences";
import type { PreferenceFact } from "@/types/interview-session";

export interface SliderQuestionConfig {
  /**
   * `keyof PreferenceWeights` rather than the narrower `QuickQuestionKey |
   * DeepSliderKey` — every legacy-interview config below still only ever
   * uses those two, but the adaptive interview's own inline slider wrapper
   * (`AdaptiveInterview.tsx`'s `SliderStepInline`) reuses this same shape
   * for every explicit-weight id, including "riskTolerance"/
   * "adminEffortAppetite", which aren't part of either legacy union (see
   * `ExplicitWeightKey`'s own doc comment in `types/interview-session.ts`).
   */
  key: keyof PreferenceWeights;
  question: string;
  /** Optional richer, pilot-voice explanation shown under the question — falls back to a generic line when omitted. */
  helpText?: string;
  lowLabel: string;
  highLabel: string;
  centerLabel: string;
}

export const QUICK_QUESTIONS: SliderQuestionConfig[] = [
  {
    key: "tripLength",
    question: "Short trips or long trips?",
    helpText:
      "This is about how many days a single trip runs, report to release. Right after this, there's a separate question about how many total departures you want in the month — those aren't the same thing.",
    lowLabel: "Prefer short trips",
    highLabel: "Prefer long trips",
    centerLabel: "No strong preference",
  },
  {
    key: "reportTime",
    question: "Early report or late report?",
    helpText:
      "An early report gets you to the airport before sunrise, but the rest of the day is yours once you're done. A late report lets you sleep in and ease into it, but you're flying well into the night.",
    lowLabel: "Prefer early reports",
    highLabel: "Prefer late/evening reports",
    centerLabel: "No strong preference",
  },
  {
    key: "creditHours",
    question: "Optimizing more for pay, or more for lifestyle?",
    helpText:
      "Not about total hours flown — a maxed-out line is fine if it's still enjoyable to fly. This is about what you're actually optimizing for day to day.",
    lowLabel: "Lifestyle — a schedule that's genuinely enjoyable to live with",
    highLabel: "Pay — maximize credit hours, however busy that makes it",
    centerLabel: "Both matter about equally",
  },
  {
    key: "circadianHealth",
    question: "How much should we protect your sleep and body clock?",
    helpText:
      "Every trip gets a real circadian score behind the scenes — how hard a time-zone shift is to adapt to, whether a report lands in the 2-6am window your body's alertness naturally bottoms out in, whether a layover gives you a real chance at 8 hours of sleep. This is how much that should actually move your ranking, versus just being something you can look up on a trip.",
    lowLabel: "Doesn't need to be a factor",
    highLabel: "Protect it, even if it costs me elsewhere",
    centerLabel: "Somewhat matters",
  },
];

const DEADHEAD_LOCAL: SliderQuestionConfig = {
  key: "deadheadTolerance",
  question: "How much does deadheading bother you?",
  helpText:
    "A deadhead leg is dead time — you're riding along, not flying it and not getting paid to fly it. Based locally, that's mostly just time you'd rather spend at home or actually at the controls.",
  lowLabel: "Avoid deadhead legs",
  highLabel: "Doesn't matter to me",
  centerLabel: "No strong preference",
};

const DEADHEAD_COMMUTER: SliderQuestionConfig = {
  key: "deadheadTolerance",
  question: "Where do you land on deadheads, given you commute?",
  helpText:
    "A deadhead can actually work in your favor as a commuter — it can position you without having to fly (or pay for) getting there yourself, and plenty of commuters specifically like a deadhead on both ends of a trip. Others would still rather fly every leg themselves. Where do you land?",
  lowLabel: "Avoid deadhead legs",
  highLabel: "Like having them — makes commuting easier",
  centerLabel: "Depends on the trip",
};

/** Same low=avoid/high=doesn't-mind-or-likes-it ordering in both variants, so the underlying weight sign stays consistent regardless of which wording was shown. */
export function deadheadQuestionFor(isCommuter: boolean | null): SliderQuestionConfig {
  return isCommuter ? DEADHEAD_COMMUTER : DEADHEAD_LOCAL;
}

/**
 * Food, gym, and grocery are all "is a nearby amenity present" counts —
 * genuinely similar enough in kind that asking a separate magnitude slider
 * for each was padding. One multi-select replaces all three: pick whichever
 * actually matter, each one flips its weight to `HOTEL_AMENITY_WEIGHT`
 * rather than a graded slider position, trading nuance for speed. Room
 * quietness and overall quality stay their own sliders below — those are
 * review-derived sentiment, not amenity counts, so a magnitude genuinely
 * means something different for them.
 */
export interface HotelAmenityOption {
  key: "hotelFood" | "hotelGym" | "hotelGrocery";
  label: string;
  description: string;
}

export const HOTEL_AMENITIES: HotelAmenityOption[] = [
  {
    key: "hotelFood",
    label: "Walkable food or coffee",
    description:
      "Some layovers put you in walking distance of a real meal; others leave you with room service or a rental car.",
  },
  {
    key: "hotelGym",
    label: "Gym or fitness access",
    description: "Makes it a lot easier to keep training on the road instead of losing the routine every trip.",
  },
  {
    key: "hotelGrocery",
    label: "Grocery or pharmacy nearby",
    description: "Lets you restock snacks, meds, or anything you forgot without needing a car.",
  },
];

/** Flat "cares about this" weight applied when a pilot flags an amenity as mattering — see `HOTEL_AMENITIES`. */
export const HOTEL_AMENITY_WEIGHT = 75;

export const DEEP_SLIDERS: SliderQuestionConfig[] = [
  DEADHEAD_LOCAL,
  {
    key: "hotelQuiet",
    question: "How much does a quiet, low-noise room matter for sleeping on the road?",
    helpText:
      "Room noise is one of the biggest things reviews call out about a layover hotel — thin walls, street noise, or a bar right below your room can wreck a rest period you were counting on.",
    lowLabel: "Doesn't matter much — I can sleep through anything",
    highLabel: "Matters a lot — noise wrecks my rest",
    centerLabel: "Somewhat matters",
  },
  {
    key: "hotelQuality",
    question: "How much does overall hotel quality — cleanliness, service, comfort — matter to you?",
    helpText:
      "This folds together cleanliness, service, and overall comfort — the stuff that turns a fine layover into a rough one, separate from food, gym, or noise specifically.",
    lowLabel: "Doesn't matter much either way",
    highLabel: "Matters a lot — a rough hotel ruins the trip",
    centerLabel: "Somewhat matters",
  },
  {
    key: "daysOff",
    question: "Days off — a compact schedule, or as many as you can get?",
    helpText:
      "This is about overall days off for the month, not any single trip's length.",
    lowLabel: "Fine with a compact schedule, fewer days off",
    highLabel: "Wants more days off / a lighter schedule",
    centerLabel: "No strong preference",
  },
  {
    key: "international",
    question: "Domestic flying, or international?",
    helpText:
      "How much of your line's flying you actually want crossing a border, versus staying domestic.",
    lowLabel: "Prefer mostly domestic flying",
    highLabel: "Prefer a strong international mix",
    centerLabel: "No strong preference",
  },
  {
    key: "landings",
    question: "More landings for currency, or fewer for a lighter workload?",
    helpText:
      "Some pilots want more landings for proficiency and currency comfort; others, especially managing fatigue, want fewer.",
    lowLabel: "Fewer landings — keep workload light",
    highLabel: "More landings — proficiency/currency comfort",
    centerLabel: "No strong preference",
  },
  {
    key: "riskTolerance",
    question: "If a rare, hard-to-hold line existed, would you rank it high anyway?",
    helpText:
      "A Strategies-board input, not a line-scoring dimension — this never changes how any line's own Satisfaction Index is computed, only which Strategies-board moves get surfaced for you.",
    lowLabel: "Only bid what I'm confident about",
    highLabel: "Rank the reach high anyway",
    centerLabel: "Depends on the line",
  },
  {
    key: "adminEffortAppetite",
    question: "Would you put in real extra effort for a better outcome?",
    helpText:
      "Filing a grievance, working a manual trade, chasing every re-bid window — a Strategies-board input, not a line-scoring dimension.",
    lowLabel: "Wants the low-effort outcome",
    highLabel: "Would do the extra work",
    centerLabel: "Depends on how much it'd help",
  },
];

export interface TargetSliderQuestionConfig {
  key: ExplicitTargetKey;
  question: string;
  helpText: string;
  unitSingular: string;
  unitPlural: string;
  /** Formats the raw value for display, e.g. "68:00" for credit hours. */
  formatValue: (value: number) => string;
  step: number;
  /**
   * Overrides the generic "your slider answer will be used instead" text
   * shown when this target is skipped — needed for a dimension with no
   * bipolar slider counterpart (nights home, departures).
   */
  noTargetFallbackText?: string;
}

export function formatHoursValue(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

const NO_SLIDER_FALLBACK_TEXT = "No exact target set — this won't be weighted specifically in your ranking.";

/** Pinned nights-home target — bare-number shape used by `formatExplicitTarget` for review screens; the adaptive interview now asks the underlying question itself, up to three times, one per `rangeRole`. */
export const NIGHTS_HOME_CONFIG: TargetSliderQuestionConfig = {
  key: "daysOff",
  question: "What does your ideal bid month look like?",
  helpText:
    "How many nights do you want to actually sleep in your own bed this bid period? Drag to the number that feels right — bounded to what's actually available in this bid pack.",
  unitSingular: "night home",
  unitPlural: "nights home",
  formatValue: (v) => String(Math.round(v)),
  step: 1,
  noTargetFallbackText: NO_SLIDER_FALLBACK_TEXT,
};

/** Pinned departures target — bare-number shape used by `formatExplicitTarget` for review screens; the adaptive interview now asks the underlying question itself, up to three times, one per `rangeRole`. */
export const DEPARTURES_CONFIG: TargetSliderQuestionConfig = {
  key: "departures",
  question: "How many separate departures do you want in a month?",
  helpText:
    "A handful of short trips bunched together can still add up to a lot of separate report times, even if it only reads as \"a couple trips.\" This is about how many times you actually leave home, not how many trips it gets counted as.",
  unitSingular: "departure",
  unitPlural: "departures",
  formatValue: (v) => String(Math.round(v)),
  step: 1,
  noTargetFallbackText: NO_SLIDER_FALLBACK_TEXT,
};

/** Exact targets other than nights home and departures, which have their own configs (`NIGHTS_HOME_CONFIG`, `DEPARTURES_CONFIG`). */
export const TARGET_SLIDERS: TargetSliderQuestionConfig[] = [
  {
    key: "creditHours",
    question: "What's your ideal credit for the month?",
    helpText: "Pin an exact credit-hour target instead of just leaning toward \"more\" or \"less.\"",
    unitSingular: "hour",
    unitPlural: "hours",
    formatValue: formatHoursValue,
    step: 0.25,
  },
  {
    key: "circadianTolerance",
    question: "How many consecutive early/late reports can you handle?",
    helpText: "Personalizes how a rough report-time stretch actually scores for you, rather than a one-size-fits-all rule.",
    unitSingular: "report in a row",
    unitPlural: "reports in a row",
    formatValue: (v) => String(Math.round(v)),
    step: 1,
  },
];

/** Every exact-target config, quick-round and deep-round alike — for screens that summarize whatever the pilot pinned, regardless of which round asked it. */
export const ALL_TARGET_CONFIGS: TargetSliderQuestionConfig[] = [
  NIGHTS_HOME_CONFIG,
  DEPARTURES_CONFIG,
  ...TARGET_SLIDERS,
];

/**
 * Renders either shape `PreferenceProfile.explicitTargets[key]` can hold —
 * today's bare number (unchanged: "18 nights home"), or a `RangeTarget`
 * tolerance band ("16-20 nights home, ideal 18") for the two keys
 * (`daysOff`/`departures`) that can now carry one. Shared by every screen
 * that lists pinned targets so the format stays consistent in one place.
 */
/**
 * Filters a slider-config list down to keys the adaptive interview actually
 * asked about (per `discoveredFacts`), so a review screen doesn't show a
 * full wall of sliders still sitting at their untouched default. A profile
 * with no discovered facts at all — the legacy static interview, which
 * always walks every slider by design, or a profile from before this field
 * existed — keeps showing every slider, exactly as before this filter
 * existed.
 */
export function touchedSliderConfigs<T extends { key: keyof PreferenceWeights }>(
  configs: T[],
  discoveredFacts: PreferenceFact[]
): T[] {
  if (discoveredFacts.length === 0) return configs;
  const touchedKeys = new Set(
    discoveredFacts
      .map((f) => f.measurable)
      .filter((m) => m?.type === "explicit-weight")
      .map((m) => (m as { key: string }).key)
  );
  return configs.filter((c) => touchedKeys.has(c.key));
}

export function formatExplicitTarget(config: TargetSliderQuestionConfig, value: number | RangeTarget): string {
  if (typeof value === "number") {
    return `${config.formatValue(value)} ${value === 1 ? config.unitSingular : config.unitPlural}`;
  }
  const { min, ideal, max } = value;
  if (min !== undefined && max !== undefined) {
    const idealPart = ideal !== undefined ? `, ideal ${config.formatValue(ideal)}` : "";
    return `${config.formatValue(min)}–${config.formatValue(max)} ${config.unitPlural}${idealPart}`;
  }
  if (min !== undefined) return `at least ${config.formatValue(min)} ${config.unitPlural}`;
  if (max !== undefined) return `up to ${config.formatValue(max)} ${config.unitPlural}`;
  if (ideal !== undefined) return `${config.formatValue(ideal)} ${config.unitPlural}`;
  return `— ${config.unitPlural}`;
}

function findDeepSlider(key: DeepSliderKey): SliderQuestionConfig {
  const found = DEEP_SLIDERS.find((q) => q.key === key);
  if (!found) throw new Error(`Missing deep slider config for "${key}"`);
  return found;
}

/** One deep-round step can be a plain bipolar slider or the hotel-amenities multi-select — see `HOTEL_AMENITIES`. */
export type DeepStepConfig =
  | { kind: "slider"; config: SliderQuestionConfig }
  | { kind: "amenities" };

export const DEEP_STEPS: DeepStepConfig[] = [
  { kind: "slider", config: DEADHEAD_LOCAL },
  { kind: "amenities" },
  { kind: "slider", config: findDeepSlider("hotelQuiet") },
  { kind: "slider", config: findDeepSlider("hotelQuality") },
];

export interface TradeoffOption {
  label: string;
  description: string;
}

export interface TradeoffQuestionConfig {
  id: string;
  /** Dimension this trade-off nudges. */
  dimension: QuickQuestionKey | DeepSliderKey;
  prompt: string;
  /** Optional pilot-voice context shown under the prompt — falls back to a generic line when omitted. */
  helpText?: string;
  optionA: TradeoffOption;
  optionB: TradeoffOption;
  /**
   * Which option represents the dimension's "positive" / high-label
   * direction (e.g. for tripLength, the highLabel is "Prefer long trips").
   * Required so the nudge direction is always explicit and can't silently
   * end up backwards when a question is authored with the intuitive option
   * first rather than the "low" one first.
   */
  positiveOption: "A" | "B";
}

export const TRADEOFF_QUESTIONS: TradeoffQuestionConfig[] = [
  {
    id: "trip-length-shape",
    dimension: "tripLength",
    prompt: "Same total credit, two different shapes — which trip would you rather fly?",
    helpText:
      "Same pay, same total time away from base, just packaged differently. This is the trip-length trade-off in its purest form.",
    optionA: {
      label: "One 5-day trip",
      description: "Fewer trips, longer stretches away from base.",
    },
    optionB: {
      label: "Two 2-day trips",
      description: "Same total credit, more time back at base in between.",
    },
    positiveOption: "A",
  },
  {
    id: "international-vs-domestic",
    dimension: "international",
    prompt: "Given a free choice for one layover, which would you actually pick?",
    optionA: {
      label: "An international layover",
      description: "A long overnight somewhere overseas.",
    },
    optionB: {
      label: "An all-domestic week",
      description: "Shorter hops, your own bed more nights.",
    },
    positiveOption: "A",
  },
  {
    id: "report-time-shape",
    dimension: "reportTime",
    prompt: "Which report would you actually take?",
    optionA: {
      label: "An early-morning report",
      description: "Up before dawn, evenings free.",
    },
    optionB: {
      label: "A late-evening report",
      description: "Sleep in, fly through the night.",
    },
    positiveOption: "B",
  },
  {
    id: "credit-vs-downtime",
    dimension: "creditHours",
    prompt: "On one specific duty day, would you rather have...",
    helpText:
      "The same trade-off as the pay-vs-lifestyle question earlier, just narrowed down to a single day instead of the whole month.",
    optionA: {
      label: "Extra credit hours",
      description: "A busier day, more pay.",
    },
    optionB: {
      label: "Fewer duty hours",
      description: "A lighter day, more downtime on the road.",
    },
    positiveOption: "A",
  },
  {
    id: "days-off-vs-fuller-schedule",
    dimension: "daysOff",
    prompt: "Would you rather have...",
    helpText:
      "Same idea as the nights-home question earlier, posed as a direct trade-off against a fuller schedule.",
    optionA: {
      label: "More nights home",
      description: "A lighter schedule — more nights actually home this month.",
    },
    optionB: {
      label: "A fuller schedule",
      description: "Fewer nights home, but more trips and more total pay.",
    },
    positiveOption: "A",
  },
  {
    id: "deadhead-vs-longer-trip",
    dimension: "deadheadTolerance",
    prompt: "Would you rather have...",
    helpText:
      "A real scenario: a deadhead leg gets you home without flying it, but it's still time you're not being paid to fly. Which would you actually pick?",
    optionA: {
      label: "A deadhead leg home",
      description: "You ride along, no flying, gets you back sooner.",
    },
    optionB: {
      label: "A trip that avoids it",
      description: "Slightly longer, but you fly every leg yourself.",
    },
    positiveOption: "A",
  },
  {
    id: "hotel-quality-vs-credit",
    dimension: "hotelQuality",
    prompt: "Would you rather have...",
    optionA: {
      label: "A well-reviewed hotel in a good spot",
      description: "Even if it means a slightly leaner schedule.",
    },
    optionB: {
      label: "Whatever hotel — don't care",
      description: "Just tell me the credit and days off.",
    },
    positiveOption: "A",
  },
];
