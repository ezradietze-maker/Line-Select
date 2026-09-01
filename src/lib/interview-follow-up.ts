import type { SliderQuestionConfig } from "@/lib/interview-config";

/** How far a slider has to lean before it's worth asking why — a genuinely strong preference, not just a mild one. */
export const FOLLOW_UP_THRESHOLD = 75;
/** Caps how often the interview asks — a rare, optional moment on a real strong answer, not a tax on every step. */
export const MAX_FOLLOW_UPS = 2;

/** True only the moment a slider is eligible for its one-time follow-up — already-shown keys and the session cap both close this back off. */
export function shouldOfferFollowUp(key: string, value: number, shownKeys: ReadonlySet<string>): boolean {
  return Math.abs(value) >= FOLLOW_UP_THRESHOLD && !shownKeys.has(key) && shownKeys.size < MAX_FOLLOW_UPS;
}

/** Plain-language framing handed to the classifier — the question and which label the pilot leaned toward, not a specific trip pair. */
export function followUpContextFor(config: SliderQuestionConfig, value: number): string {
  const leaned = value > 0 ? config.highLabel : config.lowLabel;
  return `Question: "${config.question}"\nThey leaned strongly toward: "${leaned}"`;
}
