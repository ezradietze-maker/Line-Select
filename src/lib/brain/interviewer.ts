import type { PilotModel } from "@/types/pilot-model";
import type { InterviewExchange } from "./build-model";
import { structuredCall, withSpent, type BrainUsage } from "./llm";
import { avoidedPhrases, insteadOf, inventedLimit, pilotWordsForPrompt } from "./pilot-words";
import { workedExamplesForPrompt, type QuestionKind } from "./interview-examples";
import { examplesTranscript, type QuestionExample } from "./question-examples";
import { reviewQuestion } from "./question-review";
import { askedTopics, type TopicCandidate } from "./question-topics";
import { askedTripPairs, TRIP_PAIR_QUESTION, tripPairTranscript, type TripPairCandidate } from "./trip-pairs";

/**
 * The interviewer: given everything a pilot has said and the brain's current
 * model of them, decide the single next question — or that the interview is
 * done. There is no topic checklist. Every question comes from the pilot's
 * own threads (things they raised that would change their ranking if
 * understood better) or from a real tension in their own pack, put to them
 * with their own words and the pack's real lines and numbers.
 *
 * It runs every turn, so it's quick (Sonnet, medium effort) and small: the
 * heavy reading — rebuilding the whole model from every answer — happens in
 * the background every few answers (`build-model.ts`).
 */

export const INTERVIEWER_MODEL = process.env.INTERVIEWER_MODEL || "claude-sonnet-5-5";

/** Where the interview stands on one thread, kept by the client across model rebuilds. */
export interface ThreadState {
  status: "open" | "settled" | "parked";
  timesAsked: number;
}

/** One thing the pilot cares about that two lines differ on, in real numbers. */
export interface LinePairDifference {
  label: string;
  metric: string;
  a: string;
  b: string;
  better: "a" | "b";
}

/** Two real lines from the pack that pull this pilot's priorities against each other — offered to the interviewer, which may ask the pilot to choose. */
export interface LinePairCandidate {
  index: number;
  a: string;
  b: string;
  /** The headline trade (each line's strongest point, by metric, sorted) — so the same trade isn't asked over and over. */
  trade: string;
  /** What each line is better on, in real numbers. */
  tension: string;
  /** Every difference the pilot is shown (3–5), each line winning some. Older saved interviews have none. */
  differences?: LinePairDifference[];
  summaryA: string;
  summaryB: string;
}

export interface InterviewStepInput {
  packBrief: string;
  pilotContext: string;
  exchanges: InterviewExchange[];
  model: PilotModel | null;
  threads: Record<string, ThreadState>;
  linePairs: LinePairCandidate[];
  /** Real lines and trips from their pack at both ends of their main priorities, to show with a question (see `question-examples.ts`). */
  examples?: QuestionExample[];
  /** Line and trip numbers in their pack, so a question can't name one that doesn't exist. */
  packNumbers?: { lines: string[]; trips: string[] };
  /** Two real trips that pull their priorities against each other, offered for a trip choice (see `trip-pairs.ts`). */
  tripPairs?: TripPairCandidate[];
  /** Whether a second, cheaper reader checks each question before it's shown (see `question-review.ts`); on unless false. */
  review?: boolean;
  /** The topics worth asking now, most useful first (see `question-topics.ts`); a question picks one. */
  topics?: TopicCandidate[];
  /** The topic of the question just answered — the one topic that may be asked a second time, when the answer left it unclear. */
  lastTopic?: string | null;
  /** Answers given so far after the opening steps. */
  turn: number;
  maxTurns: number;
  /** Anonymous patterns from other pilots in the same group, when there are enough of them. */
  fleetNotes?: string | null;
  /**
   * For each time the brain re-read the interview, how many of the pilot's top-10 lines changed (oldest first). Small
   * numbers in a row mean the answers have stopped moving the ranking — time to wrap up.
   */
  rankingShifts?: number[];
  apiKey?: string;
}

export type InterviewStep =
  | { done: true; reason: string; settled: string[]; usage?: BrainUsage }
  | {
      done: false;
      settled: string[];
      threadId: string | null;
      kind: "free-text" | "choice" | "line-pair" | "trip-pair";
      /** Which of the four kinds of question the interviewer wrote (see `interview-examples.ts`); absent on the fixed ones. */
      questionKind?: QuestionKind;
      /** The topic it asks about (see `question-topics.ts`), counted so it isn't asked again. */
      topic?: string;
      /** A short line taking in their last answer, said before the next question — empty on the first. */
      ack?: string;
      prompt: string;
      helpText?: string;
      options?: string[];
      pair?: LinePairCandidate;
      /** For a trip choice: the two trips. */
      tripPair?: TripPairCandidate;
      /** The real lines and trips shown with the question. */
      examples?: QuestionExample[];
      /** For the fixed priority-order question: the criterion behind each option (see `priority-order.ts`). */
      priorityIds?: string[];
      /** How the question goes into the transcript when it differs from the prompt (e.g. with its options). */
      transcript?: string;
      /** For trip grades: the trips to grade (see `trip-sort.ts`). */
      tripScreen?: import("./trip-sort").TripGradeScreen;
      usage?: BrainUsage;
    };

const SYSTEM = `You are interviewing a FedEx pilot about how they bid their monthly lines, on behalf of a bidding assistant. A separate "brain" has read everything they've said and keeps a model of them: criteria (what they care about, each measured on their real bid pack, with a weight) and threads (open questions whose answers would change their ranking). You choose the ONE next question — or decide the interview is done.

LEARN FROM A REAL PILOT
The kinds of question below come from a real interview with an ex-FedEx captain. Read what worked and what didn't, and write questions like the ones that worked: about their own pack and their own words, one thing each. Four times he answered a question asked in the abstract the same way — show me real lines or trips — and his best answers came from real choices, where one "why" named four or five things he cares about.

${workedExamplesForPrompt()}

WHAT TO ASK ABOUT
The app has worked out TOPICS WORTH ASKING NOW: what's still unclear about this pilot and would move their top 20 the most, most useful first, with how many of their top 20 an answer could move. Ask about one of them (set topic to its id), usually the first, in the kind its "Unclear" says: how much it matters → a real choice (or their own words, if no line pair pulls it against another priority); the number → their number; a feature they never mentioned → a feature question. Never ask how they feel about something they already told you they like or avoid — what's unclear about it is how much, and a real choice shows that. Each topic is asked once; the topic just answered may be asked once more, only if their answer left it unclear. When no topics are listed, ask what their own words and the threads still leave open.

THE RULES THAT COME WITH THEM
- One question, one ask. prompt is the plain question, one sentence a pilot would say out loud, about 20 words at most. helpText carries the lines, trips and figures under it, in a sentence or two.
- Weigh priorities against each other only with a real choice (an offered line pair or trip pair). Never in words: no "would you give up", "how much would X be worth", "next to", "compared with", "over two where…". If no pair pulls the two apart, ask about something else.
- Only real lines and trips from their pack, by number — from the line pairs, the examples, or what they've already been shown. Never a made-up one ("say a trip had…", "a line with…").
- Only what they alone know. Never ask what the app works out itself: which reports a commuter can make the same day or how late they can land and still get home (their home airport, the time they leave before a report and real flights decide it), how many other flights they'd want (the owner called it unnecessary), what counts as a departure, or a carry-over. Commuters are asked separately how much time they leave before a report — never ask it.
- Never re-ask a settled thread or a question already asked in any wording, and never ask two questions about the same thing. If an answer was vague, at most one follow-up, then move on.
- Never put a rule in their mouth: they rank lines rather than throw any out. Say firm, hard no, cap, never or rules it out only when their answer did.
- Never ask about filing grievances, re-bid windows, or whether they'd bid a line they might not hold — every line gets ranked regardless.
- A bid month is four weeks (eight of the year's) or five (four of them); this pack's is in the brief. A line's last trip can run into the next bid month: that carry-over ("C/O" in the pack) is the next month's, and every count here is the bid month's alone. Say a line "carries 6:08 C/O into November" — never call it a "five-week line".

SHOWING LINES AND TRIPS
A their-words, feature or their-number question can show EXAMPLES YOU MAY SHOW (set examples to their ids): two lines at the two ends of the one thing you're asking about, with their figure, or one trip — never lines and a trip together. Take them from the group of the priority the question is about. If no group shows the very thing you're asking (a hotel-standby stretch, a deadhead from home, one city like IND), show none, or name the real line that has it in helpText and it will be shown. Every line or trip you name in the question is shown under it. A real-choice question shows its two lines or trips itself: no examples.

ACK — SOUND LIKE A PILOT, NOT A FORM
You're a line pilot who has bid for years, talking to a colleague. Before each question, write ack: one short line (at most 14 words) that takes in what they just said, in their terms, like you'd say it across the crew room ("Saturdays over Sundays — got it."). No praise, no "I understand", no repeating their whole answer. "Ideally no more than two" is a preference ("Two or fewer, ideally — got it"), not "a firm cap". Leave ack empty for the very first question. Vary how questions open.

PILOT WORDS
Say things the way the pack prints them and a pilot says them. A word this pilot brought up themselves can be said back to them, but only because they said it. Their priorities' names and the fleet notes don't count as their words. Otherwise:
${pilotWordsForPrompt()}
Write as you'd say it out loud: whole, plain sentences, never a label and a number glued together, never shorthand from a trip's summary ("×4 standby days" is "four standby days"). Times and lengths the way you'd say them: "a 9:50 pm show", "about 13 hours". Their priorities' names are written as wishes ("Avoid duty periods over 12 hours"): talk about the thing itself ("long duty periods").

THE FORM OF THE QUESTION (kind)
- line-pair: every real-choice question. Set pairIndex to the offered pair. The prompt asks which they'd bid higher, naming both lines ("Which line would you bid higher: 2031 or 2044?"); helpText says the two or three differences that matter most to them, in their terms, with the right figure on the right line.
- trip-pair: a real choice between two trips, when what's being weighed shows up trip by trip (a deadhead from home against a layover they love, one-leg duties against pay per day away). Set tripPairIndex to an offered trip pair. The prompt asks which they'd rather fly, naming both ("Which trip would you rather fly: #50 on Oct 1 or #104 on Oct 2?"); helpText says the two or three differences that matter most to them. At most two in an interview — the trip grades at the end cover many trips at once.
- choice: 2–4 concrete options make it quicker (they can still add a note), like how they feel about hotel standby: "I like them / I don't mind / I'd rather fly". Options mutually exclusive, in their terms.
- free-text: everything else.

PACING
- About every other question is a real choice, but never two in a row.
- After a line choice, if what tipped it isn't clear from their answer and it would change the ranking, one their-words follow-up on why is worth asking.
- In a monthly check-in (see PILOT), start with whatever they said has changed or is new this month, then this pack's own tensions; don't re-cover what last month's interview settled.

FLEET NOTES
When given, anonymous patterns from other pilots in the same group. A topic pilots like this often care about, that this pilot hasn't touched, can be worth one feature question — asked about them, never asserted.

SETTLED
List the ids of every thread their latest answer resolved (or made moot).

DONE
Every criterion that matters to them (weight 0.4 or more) marked "not yet probed" is known only from their opening story: get to each with a question or a real choice before finishing. Set done when that's covered, no open thread would still change their ranking meaningfully, and their last answers stopped adding anything new — or when they've answered maxTurns questions. RANKING STABILITY (below) is one signal, not the whole answer.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["settled", "done", "reason", "threadId", "topic", "questionKind", "theirWords", "kind", "ack", "prompt", "helpText", "options", "pairIndex", "tripPairIndex", "examples"],
  properties: {
    settled: { type: "array", items: { type: "string" }, description: "Thread ids the latest answer resolved." },
    done: { type: "boolean" },
    reason: { type: "string", description: "One line: why this question (or why done)." },
    threadId: { type: "string", description: "The thread this question explores; empty when it follows up on something new." },
    topic: { type: "string", description: "The id of the TOPICS WORTH ASKING NOW entry this question is about; empty for a real choice that weighs several." },
    questionKind: { type: "string", enum: ["real-choice", "their-words", "feature", "their-number"], description: "Which of the four kinds this question is (see THE FOUR KINDS OF QUESTION)." },
    theirWords: { type: "string", description: "For their-words: their exact words you're asking about, copied from their answers. Empty otherwise." },
    kind: { type: "string", enum: ["free-text", "choice", "line-pair", "trip-pair"], description: "The form: line-pair or trip-pair for every real-choice question, choice or free-text for the rest." },
    ack: { type: "string", description: "One short line (≤14 words) taking in their last answer, before the question. Empty on the first question or when done." },
    prompt: { type: "string", description: "The question, as the pilot will read it. Empty when done." },
    helpText: { type: "string", description: "Optional one-line hint under the question; empty for none." },
    options: { type: "array", items: { type: "string" }, description: "2–4 options for a choice question; empty otherwise." },
    pairIndex: { type: "integer", description: "The offered line pair for a line-pair question; -1 otherwise." },
    tripPairIndex: { type: "integer", description: "The offered trip pair for a trip-pair question; -1 otherwise." },
    examples: { type: "array", items: { type: "string" }, description: "Ids from EXAMPLES YOU MAY SHOW, shown with the question: two lines of one priority, or one trip; empty for a line-pair question." },
  },
} as const;

interface RawStep {
  settled: string[];
  done: boolean;
  reason: string;
  threadId: string;
  topic: string;
  questionKind: QuestionKind;
  theirWords: string;
  kind: "free-text" | "choice" | "line-pair" | "trip-pair";
  ack: string;
  prompt: string;
  helpText: string;
  options: string[];
  pairIndex: number;
  tripPairIndex?: number;
  examples: string[];
}

/** A real choice between two lines or two trips. */
const isChoiceKind = (kind: string) => kind === "line-pair" || kind === "trip-pair";
/** Trip choices in one interview: the trip grades at the end cover many trips at once. */
const MAX_TRIP_PAIRS = 2;

function renderModel(model: PilotModel | null, threads: Record<string, ThreadState>, openingCount: number): string {
  if (!model) return "(The brain hasn't read them yet — start from their own words below.)";
  const crit = [...model.criteria]
    .sort((a, b) => b.weight - a.weight)
    .map((c) => `- ${c.label} [${c.metric}] weight ${c.weight.toFixed(2)}, confidence ${c.confidence.toFixed(2)}${isProbed(c, openingCount) ? "" : " — not yet probed"}`)
    .join("\n");
  const open = model.threads
    .map((t) => ({ ...t, ...threads[t.id] }))
    .map((t) => `- id=${t.id} [${t.status}${t.timesAsked ? `, asked ${t.timesAsked}×` : ""}] priority ${t.priority.toFixed(2)}: ${t.topic} — ${t.why}`)
    .join("\n");
  return [`SYNOPSIS: ${model.synopsis}`, `CRITERIA:\n${crit || "(none yet)"}`, `THREADS:\n${open || "(none)"}`, model.notMeasurable.length ? `NOT MEASURABLE (kept, never asked about): ${model.notMeasurable.map((n) => n.statement).join("; ")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/** How a line-choice question is recorded in the transcript ("… [Line 1011 vs Line 1018: …]"). */
const LINE_PAIR_QUESTION = / \[Line \d{3,5} vs Line \d{3,5}:/;
/** Real choices are about every other question — they taught the ex-pilot's ranking the most — but never two in a row. */
const MAX_PAIR_SHARE = 0.5;

/** Criteria that matter enough that the interview should ask about them before it ends. */
const IMPORTANT_WEIGHT = 0.4;

/**
 * Whether anything the pilot said after the opening steps (story, commute, cities) bears on this criterion — a question
 * or line choice has touched it, rather than the brain having only the story to go on.
 */
export function isProbed(c: PilotModel["criteria"][number], openingCount: number): boolean {
  return c.evidence.some((e) => e.turn >= openingCount);
}

/** How many exchanges came before the first interview question — the opening steps (and, in a check-in, last month's). */
const openingCountOf = (input: Pick<InterviewStepInput, "exchanges" | "turn">) => Math.max(0, input.exchanges.length - input.turn);

/** Important criteria the interview has only from the opening story. */
export function unprobedCriteria(input: Pick<InterviewStepInput, "exchanges" | "turn" | "model">): PilotModel["criteria"] {
  const opening = openingCountOf(input);
  return (input.model?.criteria ?? []).filter((c) => c.weight >= IMPORTANT_WEIGHT && !isProbed(c, opening));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Which priority an example shows — its id, or for an older client the name its fact opens with ("Few departures: 2 departures"). */
const priorityOf = (e: Pick<QuestionExample, "criterionId" | "priority" | "fact">) => e.criterionId ?? e.priority ?? e.fact.split(": ")[0];

/** The offered examples, grouped under the priority each shows: "Few departures:\n  E4: Line 1004 (#12 on their list) — 2 departures · …". */
function renderExamples(examples: QuestionExample[]): string {
  if (!examples.length) return "(none this turn)";
  const groups = new Map<string, QuestionExample[]>();
  for (const e of examples) groups.set(priorityOf(e), [...(groups.get(priorityOf(e)) ?? []), e]);
  return [...groups.values()]
    .map((es) => `${es[0].priority ?? "Priority"}:\n${es.map((e) => `  ${e.id}: ${e.title}${e.rank ? ` (#${e.rank} on their list)` : ""} — ${e.fact} · ${e.summary}`).join("\n")}`)
    .join("\n");
}

/** The topics worth asking, as the interviewer reads them: "standby — Hotel standby: a feature they never mentioned (Hotel standby days); an answer could move 16 of their top 20. Examples: F1, F2". */
function renderTopics(input: Pick<InterviewStepInput, "topics" | "lastTopic">): string {
  const topics = input.topics ?? [];
  const unclear = { weight: "how much it matters against their other priorities — ask it as a real choice if an offered line pair pulls it against another, otherwise in their own words", number: "the number where it starts to cost them, or stops adding — their number", feature: "how they feel about it — a feature question" };
  const lines = topics.map((t) => `- ${t.id} — ${t.label}: ${t.feature ? `a feature they never mentioned (${t.feature.label})` : `their priorities ${t.priorities.join(", ")}`}. Unclear: ${unclear[t.unclear] ?? unclear.weight}. An answer could move ${t.moves} of their top 20.${t.exampleIds.length ? ` Examples: ${t.exampleIds.join(", ")}` : ""}`);
  if (input.lastTopic) lines.push(`(Just asked: ${input.lastTopic} — ask it once more only if their answer left it unclear.)`);
  return lines.join("\n") || "(none this turn)";
}

/** A question about a made-up line or trip ("if a line instead had…", "say a trip…", "imagine a line…"). */
/** A real line set against one that doesn't exist: "would you take that over one with weaker layovers". */
const AGAINST_IMAGINED = /\b(?:over|than|instead of)\s+(?:one|a line|a trip|another line|another trip)\s+(?:with|that|where)\b/i;
/** A second question tacked on: "…, and what would tip it?", "…, and how early do you leave?" */
const THEN_ANOTHER = /[,;—–-]\s*(?:and|or)\s+(?:what|how|which|why|where|when|would|do|does|is|are)\b[^?]*\?\s*$/i;
/**
 * Asking a commuter what the app already works out from their home airport, the time they leave before a report and
 * real flights: "What's the earliest show in Anchorage you can still come up for the same day?", "How late can a trip
 * land before you can't get home that night?", "You said a 10:52 show works for coming up same day. What makes that one work?",
 * "Which trips make you go in the night before?", "What reports are early enough that you'd do that?", "How many flights home
 * from Memphis would you want?" (the owner called that one unnecessary), "How many hours before the deadhead leaves would
 * you want to be at the airport?" (the fixed commute question asks it)
 */
const COMMUTE_REACH = /\btwo departures instead of one\b|\b(?:count|counts|feel) as (?:one|a single|two|separate) departures?\b|\bhow (?:many|long)\b[^?]*\bat home\b[^?]*\b(?:two|separate) (?:departures|trips)\b|\bhow many (?:other |backup |more )?flights\b|\b(?:other|backup) flights?\b|\bhow (?:many hours|much time|long|early) before (?:the |your |a )?(?:report|show|deadhead|flying|first leg|departure)\b|\b(?:go|come|head|fly|get) (?:in|up) the (?:night|evening) before\b|\breports?\b[^?]*\bearly enough\b|\b(?:show|report)\b[^?]*\b(?:come|coming|get|getting) (?:up|in)\b[^?]*\bsame day\b|\b(?:earliest|how early)\b[^?]*\b(?:show|report)\b[^?]*\b(?:same day|that day|that morning|night before|come up|commute|get (?:up|in))\b|\bhow late\b[^?]*\b(?:land|lands|landing|release|get in|get back|back in)\b[^?]*\b(?:home|that night|same night)\b/i;
/** Text that fixes itself as it goes: "…on 2043's side. Correction: 2043 has…" (a replayed turn, Nov 2026). */
const SELF_CORRECTION = /\b(?:correction|I mean|scratch that|sorry)\b\s*[:,—–-]/i;
/** One thing weighed against a list: "how much does it matter next to layovers and days off?" */
const WEIGHED_AGAINST_SEVERAL = /\b(?:next to|compared (?:to|with)|versus|vs\.?|against)\s+[^?]*?(?:,|\band\b)/i;
/**
 * A trade asked in words: "How much credit would you give up to cut one departure?", "Would a trip that starts with a
 * deadhead be worth more to you than…", "Would you take three departures that report after noon over two where…". The
 * ex-pilot couldn't answer these in general — "show me two lines to compare and I'll tell you" — so they're asked only
 * as a real choice.
 */
const TRADE_IN_WORDS = /\bwould you give up\b|\bgive up (?:some|any|more|a bit|a little)\b|\bworth more to you\b|\bin exchange for\b|\bhow much (?:\w+ ){0,3}(?:is|would) (?:\w+ ){0,3}be worth\b|\bwould you (?:take|rather)\b[^?]*\b(?:over|or)\b/i;
/** The plain question's length; the lines and figures go in helpText. */
const MAX_PROMPT_WORDS = 25;

const HYPOTHETICAL = /\b(?:if|what if|say|imagine|suppose)\s+(?:a|another|some|the)?\s*(?:line|trip)\s+(?:instead\s+)?(?:had|has|were|was|with|that|came|paid|gave)\b|\bimagine\b|\bsuppose\b|\bhypothetical/i;

/** Line numbers a question names (four-digit numbers), and trip numbers ("trip 93", "Trip #93", "trips 93 and 98"). */
function namedNumbers(text: string): { lines: string[]; trips: string[] } {
  const lines = [...text.matchAll(/\b(\d{4})\b/g)].map((m) => m[1]);
  const trips = [...text.matchAll(/\btrips?\s+#?\s*(\d{1,4})(?:\s*(?:,|and|&)\s*#?\s*(\d{1,4}))*/gi)].flatMap((m) => [...m[0].matchAll(/\d{1,4}/g)].map((x) => x[0]));
  return { lines, trips };
}
/** A four-digit number that could be a clock time ("0430", "1755") rather than a line. */
const couldBeTime = (n: string) => Number(n.slice(0, 2)) < 24 && Number(n.slice(2)) < 60;
/** Or a year ("2026"). */
const couldBeYear = (n: string) => /^20\d\d$/.test(n);

/** The real lines a question names, each once. */
function namedPackLines(step: Pick<RawStep, "prompt" | "helpText">, input: Pick<InterviewStepInput, "packNumbers">): string[] {
  const lines = new Set(input.packNumbers?.lines ?? []);
  return [...new Set(namedNumbers(`${step.prompt} ${step.helpText}`).lines.filter((n) => lines.has(n)))];
}

/** The offered examples a question may show: those of the priorities its thread is about, when it names any. */
function examplesFitting(step: Pick<RawStep, "threadId">, input: Pick<InterviewStepInput, "examples" | "model">): QuestionExample[] {
  const about = step.threadId ? input.model?.threads.find((t) => t.id === step.threadId)?.criteria ?? [] : [];
  return (input.examples ?? []).filter((e) => !about.length || !e.criterionId || about.includes(e.criterionId));
}

/** The offered line at the other end of a shown line's priority. */
function otherEnd(e: QuestionExample, offered: QuestionExample[]): QuestionExample | undefined {
  return offered.find((x) => x.kind === "line" && x.ref !== e.ref && priorityOf(x) === priorityOf(e));
}

/** The offered trip a question names by number ("trip 97"), if any. */
function namedTripExamples(step: Pick<RawStep, "prompt" | "helpText">, offered: QuestionExample[]): { n: string; example?: QuestionExample }[] {
  return [...new Set(namedNumbers(`${step.prompt} ${step.helpText}`).trips)].map((n) => ({ n, example: offered.find((e) => e.kind === "trip" && new RegExp(`^Trip #${n}\\b`).test(e.title)) }));
}

/**
 * What a question shows, so it makes sense on its own (the owner, Nov 2026, twice):
 * - every line it names — "line 1005 has one trip, line 1055 has five" came with only 1005 shown; a named line no
 *   example of the question's priority covers is shown bare, with no figure (a feature question names the line that
 *   has the feature);
 * - lines in pairs, both ends of the priority — one 13-day line and a 13-day trip showed nothing to compare;
 * - lines or one trip, never both — unless it names the trip;
 * - only what the question's thread is about, besides what it names.
 */
function examplesToShow(step: Pick<RawStep, "prompt" | "helpText" | "examples" | "threadId" | "theirWords">, input: Pick<InterviewStepInput, "examples" | "packNumbers" | "model">): QuestionExample[] {
  const all = input.examples ?? [];
  const offered = examplesFitting(step, input);
  const chosen = [...new Set(step.examples ?? [])].slice(0, 2).flatMap((id) => offered.filter((e) => e.id === id));
  const priorities = new Set(chosen.map(priorityOf));
  const lines = chosen.filter((e) => e.kind === "line");
  const add = (e: QuestionExample | undefined) => {
    if (e && lines.length < 3 && !lines.some((x) => x.ref === e.ref)) lines.push(e);
  };
  // The other end of a chosen line's priority, so there's something to compare.
  if (lines.length === 1) add(otherEnd(lines[0], offered));
  // A named line's example comes from the shown priority, or one the question is about; otherwise it's shown bare —
  // never with another priority's figure, which reads as nonsense under it (a short-layover question showing "4
  // departures").
  const asked = topicWords(`${step.prompt} ${step.theirWords ?? ""}`);
  const onTopic = (e: QuestionExample) => priorities.has(priorityOf(e)) || [...topicWords(`${e.priority ?? ""} ${e.fact}`)].some((w) => asked.has(w));
  for (const n of namedPackLines(step, input)) {
    if (lines.some((x) => x.ref === n)) continue;
    add(offered.find((e) => e.kind === "line" && e.ref === n && onTopic(e)) ?? { id: `L${n}`, kind: "line", ref: n, title: `Line ${n}`, fact: "", summary: "" });
  }
  // A named trip shows its figure only when the figure is what the question's about; otherwise it's shown bare.
  const trips = namedTripExamples(step, all).flatMap((t) => (t.example ? [onTopic(t.example) ? t.example : { ...t.example, fact: "", priority: undefined, criterionId: undefined }] : []));
  if (lines.length) return [...lines, ...trips.slice(0, 1)];
  return [...trips, ...chosen.filter((e) => e.kind === "trip")].slice(0, 1);
}

/** Words that say the same thing about a line, so "layovers" matches a priority about cities. */
const SAME_THING: string[][] = [
  ["city", "cities"],
  ["trip", "departure", "commute"],
  ["home", "off", "break", "stretch"],
  ["leg", "duty"],
  ["night", "hub", "clock"],
  ["show", "report", "early"],
  ["credit", "pay"],
  ["standby"],
  ["deadhead"],
];
/** Domiciles and hubs: a city named on both sides says nothing about whether two things are the same topic. */
const PLACES = ["memphis", "anchorage", "indianapolis", "oakland", "newark", "cincinnati", "greensboro", "mem", "anc", "ind", "oak", "ewr", "domicile"];
const STOP = new Set([...PLACES, "day", "days", "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "with", "you", "your", "do", "does", "how", "what", "is", "are", "it", "that", "this", "more", "less", "few", "fewer", "avoid", "time", "line", "lines"]);
const stem = (w: string) => w.replace(/(?:ies)$/, "y").replace(/(?:s)$/, "");
const topicWords = (text: string) => {
  const words = norm(text).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  return new Set(words.flatMap((w) => SAME_THING.find((g) => g.some((x) => stem(x) === w))?.map(stem) ?? [w]));
};

/**
 * Whether the examples a question chose show what it asks about: their priority shares a word (or one that says the
 * same thing) with the question. "Home Wednesday nights and Sunday mornings" came with lines picked for their
 * departures, and "think of how a line like either would fall on those days".
 */
function examplesOnTopic(step: Pick<RawStep, "prompt" | "theirWords" | "examples">, input: Pick<InterviewStepInput, "examples">): boolean {
  const chosen = (step.examples ?? []).flatMap((id) => (input.examples ?? []).filter((e) => e.id === id));
  if (!chosen.length) return true;
  const asked = topicWords(`${step.prompt} ${step.theirWords ?? ""}`);
  return chosen.every((e) => [...topicWords(`${e.priority ?? ""} ${e.fact}`)].some((w) => asked.has(w)));
}

/** Whether these are words the pilot said: at least two words, found in their answers (spacing, case and punctuation aside). */
function saidByThem(words: string, input: Pick<InterviewStepInput, "exchanges">): boolean {
  const quote = norm(words);
  return quote.split(" ").length >= 2 && input.exchanges.some((e) => norm(e.answer).includes(quote));
}

/** Why a proposed question can't be asked, if it can't. `attempt` counts proposals this turn (0 = the first). */
function rejection(step: RawStep, input: InterviewStepInput, pairsUsed: Set<string>, attempt = 0): string | null {
  if (step.done) return null;
  if (!step.prompt.trim()) return "The question was empty.";
  // The kind it says it is, and that kind's rule (see `interview-examples.ts`).
  if (step.questionKind === "real-choice" && !isChoiceKind(step.kind)) return "A real choice is an offered line pair or trip pair: set kind line-pair (and pairIndex) or trip-pair (and tripPairIndex) — or write one of the other kinds.";
  if (isChoiceKind(step.kind) && step.questionKind !== "real-choice") return "A line pair or trip pair is a real-choice question: set questionKind real-choice.";
  if (attempt < 2 && step.questionKind === "their-words" && !saidByThem(step.theirWords, input)) return "A their-words question asks about words they said: copy their exact words, from their answers, into theirWords — or write another kind.";
  if (attempt < 2 && step.questionKind === "feature" && !(step.examples ?? []).length && !namedPackLines(step, input).length && !namedNumbers(`${step.prompt} ${step.helpText}`).trips.length)
    return "A feature question shows a line or trip that has the feature: set examples, or name the real line in helpText.";
  if (attempt < 2 && !isChoiceKind(step.kind) && !examplesOnTopic(step, input)) return "The examples you chose show a different priority from what the question asks. Show examples of exactly what you're asking about, or none.";
  // A feature question is for a feature they never mentioned — one they did is asked about in their words or a choice.
  const topic = input.topics?.find((t) => t.id === step.topic);
  if (attempt < 2 && step.questionKind === "feature" && !topic?.feature && !topic) return "A feature question is only for a feature they never mentioned, from TOPICS WORTH ASKING NOW. Something they raised themselves is asked in their own words or as a real choice.";
  if (attempt < 2 && step.questionKind === "feature" && topic && !topic.feature) return `They already raised ${topic.label.toLowerCase()} themselves, so don't ask how they feel about it. What's unclear is ${topic.unclear === "number" ? "their number" : "how much it matters: offer a line pair that pulls it against another priority, or ask in their own words"}.`;
  // One of the topics worth asking, each once — the one just answered may be asked again when its answer was unclear.
  if (attempt < 2 && !isChoiceKind(step.kind) && input.topics?.length) {
    const asked = askedTopics(input.threads);
    const again = step.topic && step.topic === input.lastTopic && (asked[step.topic] ?? 0) < 2;
    if (!input.topics.some((t) => t.id === step.topic) && !again) return `Ask about one of TOPICS WORTH ASKING NOW and set topic to its id (${input.topics.map((t) => t.id).join(", ")}).`;
  }
  if (attempt < 2 && !isChoiceKind(step.kind) && TRADE_IN_WORDS.test(step.prompt)) return "That asks them to trade one thing for another in words, which pilots can't answer in general. Offer a line pair that pulls the two apart, or ask about one thing.";
  // Only real lines and trips: a number that names nothing in their pack is an invented one.
  if (input.packNumbers) {
    const named = namedNumbers(`${step.prompt} ${step.helpText}`);
    const lines = new Set(input.packNumbers.lines);
    const trips = new Set(input.packNumbers.trips);
    const fakeLine = named.lines.find((n) => !lines.has(n) && !couldBeTime(n) && !couldBeYear(n));
    if (fakeLine) return `There's no line ${fakeLine} in their pack — name only real lines, from the examples or line pairs.`;
    const fakeTrip = named.trips.find((n) => !trips.has(n));
    if (fakeTrip) return `There's no trip ${fakeTrip} in their pack — name only real trips, from the examples.`;
  }
  const offered = new Set((input.examples ?? []).map((e) => e.id));
  const unknown = (step.examples ?? []).find((id) => !offered.has(id));
  if (unknown) return `There's no example ${unknown} — use the ids in EXAMPLES YOU MAY SHOW.`;
  // The examples show the one priority the question is about, at its two ends — never a line picked for another reason.
  const priorities = new Set((step.examples ?? []).map((id) => { const e = (input.examples ?? []).find((x) => x.id === id); return e ? priorityOf(e) : id; }));
  if (priorities.size > 1) return "Both examples have to show the same priority — the one your question is about — at its two ends. Pick them from one group.";
  // A question on a thread shows only the priorities that thread is about — "how much would you give up to avoid IND"
  // came with lines picked for their departures.
  const about = step.threadId ? input.model?.threads.find((t) => t.id === step.threadId)?.criteria ?? [] : [];
  const offTopic = about.length ? (step.examples ?? []).flatMap((id) => (input.examples ?? []).filter((e) => e.id === id)).find((e) => e.criterionId && !about.includes(e.criterionId)) : undefined;
  if (offTopic && attempt < 2) return `${offTopic.id} shows ${offTopic.priority ?? "another priority"}, not what this question is about. Show only examples of what you're asking, or none.`;
  // Lines come in pairs, so the pilot sees what more and less of it look like (see `examplesToShow`) — asked once to
  // name both, then the other end is added anyway.
  if (attempt === 0 && !isChoiceKind(step.kind)) {
    const shown = (step.examples ?? []).flatMap((id) => (input.examples ?? []).filter((e) => e.id === id));
    const lines = shown.filter((e) => e.kind === "line");
    const other = lines.length === 1 ? otherEnd(lines[0], input.examples ?? []) : undefined;
    if (other) return `Lines are shown in pairs, the two ends of the priority: show ${other.id} (${other.title} — ${other.fact}) with ${lines[0].id} and name both.`;
    if (lines.length && shown.some((e) => e.kind === "trip")) return "Show lines or one trip, not both: the two lines already show it.";
  }
  // A trip it names is the one it shows — "trip 97 goes to IND" came with two lines and no trip 97.
  if (!isChoiceKind(step.kind) && attempt < 2) {
    const chosen = new Set(step.examples ?? []);
    const unshown = namedTripExamples(step, examplesFitting(step, input)).find((t) => !t.example || !chosen.has(t.example.id));
    if (unshown) return `You name trip ${unshown.n} but don't show it. Show the trip you name, from the examples of what this question is about, and nothing else — or leave it out.`;
  }
  // The pack's words and pilots' only — a word that's in neither ("red-eye", "layover value") goes back to be said
  // properly, unless the pilot brought it up themselves.
  const theirs = input.exchanges.map((e) => e.answer).join(" ");
  const madeUp = avoidedPhrases([step.ack, step.prompt, step.helpText, ...(step.options ?? [])].join(" "), theirs)[0];
  // Never on the last try: a wording slip mustn't end the interview.
  if (madeUp && attempt < 2) return `“${madeUp}” isn't in the pack or how pilots here say it — say ${insteadOf(madeUp)}, in a plain sentence.`;
  // A reply that turns what they said into a rule they didn't give goes back once to be said as they said it; after that
  // it's dropped rather than asked again (see `nextInterviewStep`).
  const invented = attempt === 0 ? inventedLimit(step.ack ?? "", input.exchanges.at(-1)?.answer ?? "") : null;
  if (invented) return `Your reply says “${invented}”, but their answer stated no limit — say what they said as the preference it is, in their terms.`;
  if (!isChoiceKind(step.kind) && (HYPOTHETICAL.test(`${step.prompt} ${step.helpText}`) || AGAINST_IMAGINED.test(step.prompt)))
    return "That describes a made-up line or trip. Ask about the real lines or trips in the examples, or offer a line pair.";
  // One plain question, details under it — the owner couldn't follow one that stacked several (Nov 2026). Not on the
  // last try: a long question mustn't end the interview.
  if (attempt < 2 && (step.prompt.match(/\?/g) ?? []).length > 1) return "That asks more than one thing. Ask the first as its own plain question; the other can be the next question.";
  if (attempt < 2 && THEN_ANOTHER.test(step.prompt)) return "That asks two things in one (\"…, and what would…\"). Ask the first on its own; the other can be the next question.";
  if (COMMUTE_REACH.test(step.prompt)) return "The app already works out which reports they can commute in for, and when they can get home, from their home airport, the time they leave before a report and real flights. Ask something else.";
  if (attempt < 2 && SELF_CORRECTION.test(`${step.prompt} ${step.helpText}`)) return "That corrects itself partway (\"Correction: …\"). Write it once, the right way.";
  if (attempt < 2 && WEIGHED_AGAINST_SEVERAL.test(step.prompt)) return "That weighs one thing against several (\"next to layovers and days off\"). Ask about the one thing on its own; to weigh several, offer a line pair.";
  if (attempt < 2 && step.prompt.split(/\s+/).length > MAX_PROMPT_WORDS) return `Put the question in one plain sentence of ${MAX_PROMPT_WORDS} words or fewer, and the lines and figures in helpText.`;
  const t = step.threadId ? input.threads[step.threadId] : undefined;
  if (t && t.status !== "open") return `Thread ${step.threadId} is ${t.status} — don't ask about it again.`;
  if (t && t.timesAsked >= 2) return `Thread ${step.threadId} has already been asked twice — move on.`;
  const asked = new Set(input.exchanges.map((e) => norm(e.question)));
  if (asked.has(norm(step.prompt))) return "That exact question was already asked.";
  if (isChoiceKind(step.kind)) {
    const isPair = (e: InterviewExchange) => LINE_PAIR_QUESTION.test(e.question) || TRIP_PAIR_QUESTION.test(e.question);
    const last = input.exchanges.at(-1);
    if (last && isPair(last)) return "The last question was a real choice — ask something in their own words this time.";
    // About one in three, once the interview is under way: a line choice is a tool, not the format.
    // This session's own questions — `turn` counts them; a monthly check-in's transcript starts with last month's.
    const interview = input.turn > 0 ? input.exchanges.slice(-input.turn) : [];
    const pairsSoFar = interview.filter(isPair).length;
    if (interview.length >= 4 && (pairsSoFar + 1) / (interview.length + 1) > MAX_PAIR_SHARE) return "Line choices are already about half the questions — ask something else.";
    if (step.kind === "trip-pair") {
      const tp = (input.tripPairs ?? []).find((p) => p.index === step.tripPairIndex);
      if (!tp) return "That trip pair index doesn't exist.";
      if (askedTripPairs(input.exchanges).has(`${tp.a}|${tp.b}`)) return "Those two trips were already compared.";
      if (interview.filter((e) => TRIP_PAIR_QUESTION.test(e.question)).length >= MAX_TRIP_PAIRS) return `Trip choices are already ${MAX_TRIP_PAIRS} — the trip grades at the end cover more trips at once. Ask something else.`;
    } else {
      const pair = input.linePairs.find((p) => p.index === step.pairIndex);
      if (!pair) return "That line pair index doesn't exist.";
      if (pairsUsed.has(`${pair.a}|${pair.b}`) || pairsUsed.has(`${pair.b}|${pair.a}`)) return "Those two lines were already compared.";
    }
  }
  return null;
}

/** The "anything else?" screen's question, as the transcript records it — both the app and the simulator use it. */
import { isSweepQuestion, minTurnsFor, SWEEP_QUESTION } from "./interview-pace";
export { minTurnsFor, SWEEP_QUESTION };

/**
 * The answers have stopped moving the ranking: the last two re-reads each changed at most one of the pilot's top-10
 * lines, every important criterion has been asked about, and nothing important is still wide open. More questions
 * from here cost the pilot time and teach little.
 */
export function rankingHasSettled(input: Pick<InterviewStepInput, "turn" | "rankingShifts" | "model" | "threads" | "exchanges">): boolean {
  const shifts = input.rankingShifts ?? [];
  // Right after the "anything else?" screen they may have just raised something new — it gets its follow-ups first.
  if (isSweepQuestion(input.exchanges.at(-1)?.question ?? "")) return false;
  if (input.turn < minTurnsFor(input.model) || shifts.length < 2 || shifts.slice(-2).some((n) => n > 1)) return false;
  if (unprobedCriteria(input).length > 0) return false;
  const importantOpen = (input.model?.threads ?? []).some((t) => (input.threads[t.id]?.status ?? t.status) === "open" && t.priority >= 0.5);
  return !importantOpen;
}

export async function nextInterviewStep(input: InterviewStepInput): Promise<InterviewStep> {
  if (rankingHasSettled(input)) return { done: true, reason: "The last answers stopped changing the ranking.", settled: [] };
  const conversation = input.exchanges.map((e) => `[${e.turn}] Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  const pairsUsed = new Set(input.exchanges.flatMap((e) => [...e.question.matchAll(/Line (\d{3,5}) vs Line (\d{3,5})/g)].map((m) => `${m[1]}|${m[2]}`)));
  const pairs = input.linePairs.length
    ? input.linePairs
        .map((p) => {
          const diffs = p.differences?.length ? `\n   differences: ${p.differences.map((d) => `${d.label} ${d.a} vs ${d.b} (better: ${d.better === "a" ? p.a : p.b})`).join("; ")}` : "";
          return `#${p.index}: Line ${p.a} vs Line ${p.b} — ${p.tension}${diffs}\n   ${p.a}: ${p.summaryA}\n   ${p.b}: ${p.summaryB}`;
        })
        .join("\n")
    : "(none offered this turn)";
  let fresh = [
    `PILOT: ${input.pilotContext}`,
    `THE BRAIN'S CURRENT MODEL OF THEM:\n${renderModel(input.model, input.threads, openingCountOf(input))}`,
    input.fleetNotes ? `FLEET NOTES — other pilots in the same group (hints only):\n${input.fleetNotes}` : "",
    `LINE PAIRS YOU MAY OFFER:\n${pairs}`,
    `TRIP PAIRS YOU MAY OFFER:\n${(input.tripPairs ?? []).map((p) => `#${p.index}: ${p.labelA} vs ${p.labelB} — ${p.tension}\n   differences: ${p.differences.map((d) => `${d.label} ${d.a} vs ${d.b}`).join("; ")}\n   ${p.labelA}: ${p.summaryA}\n   ${p.labelB}: ${p.summaryB}`).join("\n") || "(none offered this turn)"}`,
    `TOPICS WORTH ASKING NOW:\n${renderTopics(input)}`,
    `EXAMPLES YOU MAY SHOW — real lines and trips from their pack at the two ends of each priority, grouped by priority. Show examples from the group of the priority your question is about:\n${renderExamples(input.examples ?? [])}`,
    input.rankingShifts?.length ? `RANKING STABILITY — top-10 lines changed by each re-read, oldest first: ${input.rankingShifts.join(", ")}` : "",
    `THE INTERVIEW SO FAR (${input.turn} of at most ${input.maxTurns} questions answered):\n\n${conversation}`,
    `Choose the next question, or decide the interview is done.`,
  ].filter(Boolean).join("\n\n");

  let usage: BrainUsage | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const spent = usage?.costUsd ?? 0;
    // A later attempt failing still leaves the earlier, rejected ones paid for.
    const r = await structuredCall<RawStep>({ apiKey: input.apiKey, model: INTERVIEWER_MODEL, system: SYSTEM, user: { cached: input.packBrief, fresh }, schema: SCHEMA as unknown as Record<string, unknown>, effort: "medium", maxTokens: 4000 }).catch((e) => {
      throw withSpent(e, spent);
    });
    usage = usage ? { ...r.usage, costUsd: usage.costUsd + r.usage.costUsd, ms: usage.ms + r.usage.ms } : r.usage;
    const step = r.data;
    const known = new Set(Object.keys(input.threads));
    const settled = step.settled.filter((id) => known.has(id) || input.model?.threads.some((t) => t.id === id));
    if (step.done || input.turn >= input.maxTurns) return { done: true, reason: step.reason, settled, usage };
    const why = rejection(step, input, pairsUsed, attempt);
    if (why) {
      fresh += `\n\nYour last proposal can't be used: ${why} Choose a different question.`;
      continue;
    }
    const pair = step.kind === "line-pair" ? input.linePairs.find((p) => p.index === step.pairIndex) : undefined;
    const options = step.options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
    const kind = step.kind === "choice" && options.length < 2 ? "free-text" : step.kind;
    const tripPair = step.kind === "trip-pair" ? (input.tripPairs ?? []).find((p) => p.index === step.tripPairIndex) : undefined;
    const shown = isChoiceKind(kind) ? [] : examplesToShow(step, input);
    // Read once more, the way a line pilot would, against the facts for what's on screen — not on the last try, and a
    // failed check never stops the interview.
    if (attempt < 2 && input.review !== false) {
      const facts = [
        ...shown.map((e) => `${e.title}${e.fact ? `: ${e.fact}` : ""}${e.priority ? ` (${e.priority})` : ""}${e.summary ? ` — ${e.summary}` : ""}`),
        ...(pair ? [`Line ${pair.a}: ${pair.summaryA}`, `Line ${pair.b}: ${pair.summaryB}`, ...(pair.differences ?? []).map((d) => `${d.label}: line ${pair.a} ${d.a}, line ${pair.b} ${d.b}`)] : []),
        ...(tripPair ? [`${tripPair.labelA}: ${tripPair.summaryA}`, `${tripPair.labelB}: ${tripPair.summaryB}`, ...tripPair.differences.map((d) => `${d.label}: ${tripPair.labelA} ${d.a}, ${tripPair.labelB} ${d.b}`)] : []),
      ];
      const topic = input.topics?.find((t) => t.id === step.topic);
      const review = await reviewQuestion({
        apiKey: input.apiKey,
        question: { prompt: step.prompt, helpText: step.helpText, options, questionKind: step.questionKind, ...(topic ? { topic: `${topic.label}${topic.feature ? ` (${topic.feature.label}, never mentioned)` : ""}` } : {}), facts },
        answers: input.exchanges.map((e) => e.answer),
        asked: input.exchanges.map((e) => e.question),
      }).catch(() => null);
      if (review) usage = { ...usage, costUsd: usage.costUsd + review.usage.costUsd };
      if (review && !review.ok) {
        fresh += `\n\nYour last proposal can't be used: ${review.problem} Fix that, or choose a different question.`;
        continue;
      }
    }
    return {
      done: false,
      settled,
      threadId: step.threadId || null,
      kind,
      questionKind: isChoiceKind(kind) ? "real-choice" : step.questionKind,
      ...(step.topic ? { topic: step.topic } : {}),
      // A reply still stating a limit they didn't give is left out: better no reply than a rule they never set.
      ...((step.ack ?? "").trim() && input.turn > 0 && !inventedLimit(step.ack, input.exchanges.at(-1)?.answer ?? "") ? { ack: step.ack.trim() } : {}),
      prompt: step.prompt.trim(),
      ...(step.helpText.trim() ? { helpText: step.helpText.trim() } : {}),
      ...(kind === "choice" ? { options } : {}),
      ...(pair ? { pair } : {}),
      ...(tripPair ? { tripPair, transcript: tripPairTranscript(step.prompt.trim(), tripPair) } : {}),
      // The examples go into the transcript after the question (and its options), so the brain reads what was shown.
      ...(shown.length ? { examples: shown, transcript: `${step.prompt.trim()}${examplesTranscript(shown)}` } : {}),
      usage,
    };
  }
  // Three proposals in a row couldn't be asked: the interview has run out of new ground.
  return { done: true, reason: "No new question left to ask.", settled: [], usage };
}
