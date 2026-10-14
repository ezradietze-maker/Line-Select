import { INTERVIEW_TOPIC_BACKLOG } from "@/lib/interview-topics";
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
  tripLength: "Trip length",
};

const LABELS = new Map(allKnownVariableDescriptors().map((d) => [d.id, d.label] as const));

const TOPIC_LABELS = new Map<string, string>([
  ...INTERVIEW_TOPIC_BACKLOG.map((t) => [t.id, t.label] as const),
  ["closing", "Before we finish"],
]);

/** "Days off", "Hotel standby", "Commute logistics detail" — what a question is about, for its eyebrow: the dimension a slider or number question is bound to, otherwise the topic the interview tagged it with. Null when there's nothing meaningful to say. */
export function questionTopicLabel(q: InterviewQuestion): string | null {
  if (q.kind === "target-slider") return TARGET_LABELS[q.boundTo] ?? LABELS.get(q.boundTo) ?? null;
  if (q.kind === "slider") return LABELS.get(q.boundTo) ?? null;
  return q.topic ? TOPIC_LABELS.get(q.topic) ?? null : null;
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
 * The areas a bidding story visibly touches, by plain keyword — only to
 * encourage a pilot to cover more ground ("you've covered days off and
 * layovers; anything about deadheads?"), never as extraction. The real
 * reading is the AI's job. Fine-grained on purpose: "trips" alone says little;
 * how long they are, how many legs a day, and when they report each say
 * something different about how a pilot bids.
 */
export const STORY_TOPICS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "priorities", label: "What matters most", pattern: /\b(most important|matters? (?:most|more)|priorit\w*|care (?:more|most|about)|lifestyle|quality of life|number one|first thing|top of my list|optimi[sz]e|above all)\b/i },
  { id: "days-off", label: "Days off", pattern: /\b(days? off|time off|home time|off days?|days at home)\b/i },
  { id: "blocks", label: "Blocks, weekends & dates", pattern: /\b(blocks? of|in a row|back[- ]to[- ]back|weekends?|saturdays?|sundays?|holidays?|christmas|thanksgiving|birthdays?|anniversary|specific dates?|dates? off)\b/i },
  { id: "trips", label: "Trip length", pattern: /\b(trips?|turns?|day trips?|\d[- ]days?|tafb|time away|pairings?)\b/i },
  { id: "legs", label: "Legs & duty days", pattern: /\b(legs?|duty (?:periods?|days?|time)|block (?:hours|time)|flying time|long duty|short duty)\b/i },
  { id: "times", label: "Report & release times", pattern: /\b(report\w*|show times?|release\w*|start times?|early (?:starts?|mornings?|shows?)|late (?:nights?|finish\w*|arrivals?))\b/i },
  { id: "body-clock", label: "Sleep & body clock", pattern: /\b(sleep\w*|rest|circadian|body clock|red-?eyes?|back side|night (?:flying|flights?|shifts?)|all-nighters?|fatigue\w*|tired|jet ?lag)\b/i },
  { id: "cities", label: "Layover cities", pattern: /\b(cities|city|destinations?|favou?rite (?:layovers?|places?|stops?)|layovers? (?:in|at)|[A-Z]{3} layovers?)\b/i },
  { id: "layovers", label: "Layover length & hotels", pattern: /\b(\d+[- ]?(?:hour|hr)s?(?: layovers?)?|long(?:er)? layovers?|short(?:er)? layovers?|layover (?:length|time)|hotels?|downtime|overnights?)\b/i },
  { id: "pay", label: "Pay & credit", pattern: /\b(pay|credit|money|overtime|premium|green slip|per diem|earn\w*|make more)\b/i },
  { id: "commute", label: "Commute", pattern: /\b(commut\w*|crash ?pad|jumpseat\w*|home airport|live (?:in|near)|getting to base)\b/i },
  { id: "deadheads", label: "Deadheads & backups", pattern: /\b(dead ?heads?|deadheading|deviat\w*|backup flights?|backups|positive space)\b/i },
  { id: "reserve", label: "Reserve & standby", pattern: /\b(reserve|standbys?|on call|r-?days?)\b/i },
  { id: "flying", label: "Where you fly", pattern: /\b(international|domestic|asia\w*|europe\w*|pacific|atlantic|overseas|ocean\w*|polar|china|japan|korea|australia|latin america|south america|middle east)\b/i },
  { id: "life", label: "Life outside work", pattern: /\b(kids?|daughter|son|wife|husband|partner|family|softball|soccer|school|church|class|wedding|appointment|vacation|hobby|hobbies)\b/i },
];

export function storyTopicsMentioned(text: string): Set<string> {
  return new Set(STORY_TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.id));
}

/** How long a story has to be, in words, before its length alone counts in full. */
const FULL_LENGTH_WORDS = 800;
/** How many of the areas above count as full coverage — nobody needs all of them. */
const FULL_BREADTH = 12;
/** Full credit for breadth takes at least this many words: covering an area means saying something about it. */
const BREADTH_NEEDS_WORDS = 500;

export interface StoryDepth {
  /** 0 = nothing yet, 5 = plenty. */
  level: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
  words: number;
  areas: number;
}

/**
 * How much a bidding story gives the interview to work with — by length and by how many areas it covers, together. A
 * long story about one thing, or a list of topics with nothing said about any, isn't much to go on either way. Fills
 * slowly on purpose: the stories that rank best are a page or so — several paragraphs, most of these areas.
 */
export function storyDepth(text: string): StoryDepth {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const areas = storyTopicsMentioned(text).size;
  if (words === 0) return { level: 0, label: "", words, areas };
  // Breadth counts only as far as the length backs it up — a word or two on each of ten topics isn't ten topics covered.
  const length = Math.min(1, words / FULL_LENGTH_WORDS);
  const breadth = Math.min(1, areas / FULL_BREADTH, words / BREADTH_NEEDS_WORDS);
  const score = 0.55 * length + 0.45 * breadth;
  const level = score < 0.15 ? 1 : score < 0.35 ? 2 : score < 0.55 ? 3 : score < 0.75 ? 4 : 5;
  const label = ["", "Just getting started", "A start — keep going", "Getting there", "Good detail", "Plenty to work with"][level];
  return { level, label, words, areas };
}
