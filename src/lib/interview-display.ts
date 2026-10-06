import { allKnownVariableDescriptors } from "@/lib/preference-classifier";
import type { InterviewAnswer, InterviewQuestion } from "@/types/interview-session";

/**
 * Small, pure pieces of how the interview presents itself — the topic a
 * question is about, a plain-English echo of an answer, and which topics a
 * pilot's bidding story has touched. Kept out of the components so they
 * can be tested directly.
 */

const TARGET_LABELS: Record<string, string> = {
  daysOff: "Days off",
  dutyPeriods: "Duty periods",
  creditHours: "Credit hours",
  circadianTolerance: "Early shows in a row",
};

const LABELS = new Map(allKnownVariableDescriptors().map((d) => [d.id, d.label] as const));

/** "Days off", "Hotel standby" — the topic a slider or number question is bound to, for its eyebrow. Null for choice and free-text questions, which aren't bound to one. */
export function questionTopicLabel(q: InterviewQuestion): string | null {
  if (q.kind === "target-slider") return TARGET_LABELS[q.boundTo] ?? LABELS.get(q.boundTo) ?? null;
  if (q.kind === "slider") return LABELS.get(q.boundTo) ?? null;
  return null;
}

/** How far toward a side a slider answer leans, in words — the same bands the slider itself shows. */
export function sliderStrength(value: number): "none" | "some" | "strong" {
  const m = Math.abs(value);
  return m < 10 ? "none" : m < 45 ? "some" : "strong";
}

/** The pilot's answer, said back plainly — what the interview heard, shown while it thinks about what to ask next. */
export function describeAnswer(q: InterviewQuestion, a: InterviewAnswer): string {
  if (a.kind === "skipped") return "Skipped this one.";
  if (q.kind === "slider" && a.kind === "slider") {
    const strength = sliderStrength(a.value);
    if (strength === "none") return `${q.centerLabel}.`;
    const side = a.value > 0 ? q.highLabel : q.lowLabel;
    return `${strength === "strong" ? "Strongly" : "Leaning"}: ${side}.`;
  }
  if (q.kind === "target-slider" && a.kind === "target-slider") {
    if (a.value === undefined) return "No exact number for this one.";
    const role = q.rangeRole === "min" ? "At least " : q.rangeRole === "max" ? "At most " : "";
    return `${role}${a.value} ${a.value === 1 ? q.unitSingular : q.unitPlural}.`;
  }
  if (q.kind === "choice" && a.kind === "choice") {
    const opt = q.options[a.selectedIndex];
    return opt ? opt.label : "—";
  }
  if (a.kind === "free-text") return a.text;
  return "—";
}

/** The elaboration a pilot added to a slider, number or choice answer, if any. */
export function answerElaboration(a: InterviewAnswer): string | undefined {
  return "elaboration" in a ? a.elaboration : undefined;
}

/**
 * The topics a bidding story visibly touches, by plain keyword — only to
 * encourage a pilot ("you've covered days off and layovers; anything about
 * pay?"), never as extraction. The real reading is the AI's job.
 */
export const STORY_TOPICS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "days-off", label: "Days off", pattern: /\b(days? off|time off|home time|off days?|block of days|weekends?)\b/i },
  { id: "trips", label: "Trip length", pattern: /\b(trips?|turns?|day trips?|\d-days?|long haul|short haul|pairings?)\b/i },
  { id: "layovers", label: "Layovers", pattern: /\b(layovers?|hotels?|overnights?|cities|city|[A-Z]{3} layover)\b/i },
  { id: "pay", label: "Pay & credit", pattern: /\b(pay|credit|money|hours|overtime|premium|green slip|max(?:imi[sz]e)?)\b/i },
  { id: "schedule", label: "Report times", pattern: /\b(report|show times?|shows?|early|late|red-?eyes?|back side|back of the clock|sleep|rest|circadian)\b/i },
  { id: "commute", label: "Commute", pattern: /\b(commut\w*|crash ?pad|deadhead\w*|local|live (?:in|near))\b/i },
  { id: "life", label: "Life outside work", pattern: /\b(kids?|daughter|son|wife|husband|partner|family|softball|soccer|school|church|class|birthday|wedding|anniversary|appointment)\b/i },
];

export function storyTopicsMentioned(text: string): Set<string> {
  return new Set(STORY_TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.id));
}
