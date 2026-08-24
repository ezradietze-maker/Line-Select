import type {
  DeepSliderKey,
  ExplicitTargetKey,
  QuickQuestionKey,
} from "@/types/preferences";

export interface SliderQuestionConfig {
  key: QuickQuestionKey | DeepSliderKey;
  question: string;
  lowLabel: string;
  highLabel: string;
  centerLabel: string;
}

export const QUICK_QUESTIONS: SliderQuestionConfig[] = [
  {
    key: "daysOff",
    question: "How much do you value days off?",
    lowLabel: "Don't mind fewer days off",
    highLabel: "Maximize days off",
    centerLabel: "No strong preference",
  },
  {
    key: "tripLength",
    question: "Short trips or long trips?",
    lowLabel: "Prefer short trips",
    highLabel: "Prefer long trips",
    centerLabel: "No strong preference",
  },
  {
    key: "tripCount",
    question: "How much do lots of separate trips bother you?",
    lowLabel: "Don't mind lots of trips",
    highLabel: "Prefer fewer, longer trips",
    centerLabel: "No strong preference",
  },
  {
    key: "international",
    question: "Domestic or international flying?",
    lowLabel: "Prefer domestic only",
    highLabel: "Prefer international",
    centerLabel: "No strong preference",
  },
  {
    key: "reportTime",
    question: "Early or late report times?",
    lowLabel: "Prefer early reports",
    highLabel: "Prefer late/evening reports",
    centerLabel: "No strong preference",
  },
  {
    key: "creditHours",
    question: "Lean line or max credit?",
    lowLabel: "Prefer a lean line",
    highLabel: "Maximize credit hours",
    centerLabel: "No strong preference",
  },
];

export const DEEP_SLIDERS: SliderQuestionConfig[] = [
  {
    key: "deadheadTolerance",
    question: "How much does deadheading bother you?",
    lowLabel: "Avoid deadhead legs",
    highLabel: "Doesn't matter to me",
    centerLabel: "No strong preference",
  },
  {
    key: "region",
    question: "Northeast Asia or Southeast Asia layovers?",
    lowLabel: "Prefer Northeast Asia (HKG, ICN, KIX, NRT)",
    highLabel: "Prefer Southeast Asia (SIN, BKK, CGK, KUL)",
    centerLabel: "No strong preference",
  },
  {
    key: "hotelFood",
    question: "How much does walkable food access matter at your layover hotel?",
    lowLabel: "Doesn't matter — room service or a car is fine",
    highLabel: "Matters a lot — I want to walk to a good meal or coffee",
    centerLabel: "Somewhat matters",
  },
  {
    key: "hotelGym",
    question: "How much does gym/fitness access matter at your layover hotel?",
    lowLabel: "Doesn't matter — I'll skip it or work around it",
    highLabel: "Matters a lot — I want to keep training on the road",
    centerLabel: "Somewhat matters",
  },
  {
    key: "hotelGrocery",
    question: "How much does nearby grocery/pharmacy access matter?",
    lowLabel: "Doesn't matter",
    highLabel: "Matters a lot — I like picking up snacks or essentials",
    centerLabel: "Somewhat matters",
  },
  {
    key: "hotelQuiet",
    question: "How much does a quiet, low-noise room matter for sleeping on the road?",
    lowLabel: "Doesn't matter much — I can sleep through anything",
    highLabel: "Matters a lot — noise wrecks my rest",
    centerLabel: "Somewhat matters",
  },
  {
    key: "hotelQuality",
    question: "How much does overall hotel quality — cleanliness, service, comfort — matter to you?",
    lowLabel: "Doesn't matter much either way",
    highLabel: "Matters a lot — a rough hotel ruins the trip",
    centerLabel: "Somewhat matters",
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
}

function formatHoursValue(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

export const TARGET_SLIDERS: TargetSliderQuestionConfig[] = [
  {
    key: "daysOff",
    question: "What's your ideal number of days off?",
    helpText:
      "Drag to the exact number you'd want this bid period, based on the lines actually available.",
    unitSingular: "day off",
    unitPlural: "days off",
    formatValue: (v) => String(Math.round(v)),
    step: 1,
  },
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
    key: "tripCount",
    question: "What's the most separate trips you'd want this month?",
    helpText:
      "Useful if you commute and know your limit — pins a ceiling instead of just leaning toward fewer.",
    unitSingular: "trip",
    unitPlural: "trips",
    formatValue: (v) => String(Math.round(v)),
    step: 1,
  },
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
    prompt: "Would you rather fly...",
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
    id: "trip-count-vs-length",
    dimension: "tripCount",
    prompt: "Would you rather fly...",
    optionA: {
      label: "One long 9-day trip",
      description: "A single commute round-trip covers the whole stretch.",
    },
    optionB: {
      label: "Three separate 3-day trips",
      description: "Same total time away, but three commutes instead of one.",
    },
    positiveOption: "A",
  },
  {
    id: "international-vs-domestic",
    dimension: "international",
    prompt: "Would you rather have...",
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
    id: "region-preference",
    dimension: "region",
    prompt: "Given the choice, would you rather lay over in...",
    optionA: {
      label: "Hong Kong or Seoul",
      description: "Northeast Asia — shorter flight, faster time-zone recovery.",
    },
    optionB: {
      label: "Singapore or Bangkok",
      description: "Southeast Asia — longer flight, warmer layovers.",
    },
    positiveOption: "B",
  },
  {
    id: "report-time-shape",
    dimension: "reportTime",
    prompt: "Would you rather have...",
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
    prompt: "Would you rather have...",
    optionA: {
      label: "Extra credit hours",
      description: "A busier duty day, more pay.",
    },
    optionB: {
      label: "Fewer duty hours",
      description: "More downtime on the road.",
    },
    positiveOption: "A",
  },
  {
    id: "days-off-vs-fuller-schedule",
    dimension: "daysOff",
    prompt: "Would you rather have...",
    optionA: {
      label: "More days off",
      description: "A lighter schedule, fewer total duty days this month.",
    },
    optionB: {
      label: "A fuller schedule",
      description: "Fewer days off, but more trips and more total pay.",
    },
    positiveOption: "A",
  },
  {
    id: "deadhead-vs-longer-trip",
    dimension: "deadheadTolerance",
    prompt: "Would you rather have...",
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
