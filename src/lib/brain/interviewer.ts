import type { PilotModel } from "@/types/pilot-model";
import type { InterviewExchange } from "./build-model";
import { structuredCall, withSpent, type BrainUsage } from "./llm";
import { avoidedPhrases, insteadOf, inventedLimit, pilotWordsForPrompt } from "./pilot-words";
import { examplesTranscript, type QuestionExample } from "./question-examples";

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
      kind: "free-text" | "choice" | "line-pair";
      /** A short line taking in their last answer, said before the next question — empty on the first. */
      ack?: string;
      prompt: string;
      helpText?: string;
      options?: string[];
      pair?: LinePairCandidate;
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

SOUND LIKE A PILOT, NOT A FORM
You're a line pilot who has bid for years, talking to a colleague — not a survey. Before each question, write ack: one short line (at most 14 words) that takes in what they just said, in their terms, like you'd say it across the crew room ("Saturdays over Sundays — got it." / "So the nine days off win when it's a real break."). No praise ("Great answer", "Thanks for sharing"), no "I understand", no repeating their whole answer. Never put a rule in their mouth: say firm, hard no, cap, never, out, rules it out or dealbreaker only when their answer did. "Ideally no more than two" is a preference ("Two or fewer, ideally — got it"), not "a firm cap"; "I'd hardly bid it" is not "it's out"; "the closest thing to a dealbreaker" stays that. Leave ack empty for the very first question. Vary how questions open — never start two in a row the same way, and don't fall into a template ("Line X has…, line Y has…, which would you bid?" every time).

WHAT MAKES A GOOD QUESTION
- It comes from them: one of the open threads (prefer the highest priority one), or something in their latest answer worth one follow-up. Quote or echo their own words. Never ask a generic checklist question about a topic they haven't raised — topics they never mentioned are covered later on a separate screen.
- It is grounded in their pack: use the real cities, numbers and lines in the pack brief ("Sydney only shows up on 4 lines here, and two of them…").
- It shows them, not asks them to imagine. Pilots answer real lines far better than generic questions about what they'd trade. Every question about one of their priorities shows EXAMPLES YOU MAY SHOW (set examples to their ids): two lines from their own pack at the two ends of the one thing you're asking about — what more and less of it look like — with their figure, or one trip when a single trip shows it. Lines or a trip, never both. Name them with that figure in helpText, briefly ("2031 gets you two departures; 2044 takes four."), under the plain question ("Where does the number of departures start to cost you?"). Take them from the group of the priority the question is about — never attach another priority's example because it names a line you mention. If no group shows the very thing you're asking about (a hotel-standby stretch, a deadhead from home, one city like IND), leave examples empty: lines shown for something else confuse the pilot (the owner, Nov 2026, on show times under a standby question). Prefer lines near the top of their list. Leave examples empty only for a line-pair question (the pair is the example) or when no example shows what you're asking.
- Never ask them to price one priority in another ("how many extra commutes would that layover be worth?", "how much layover would you give up for an easy commute?") — pilots can't answer that in general, only between real lines. To learn how two priorities trade, offer a line pair that pulls them apart; if none is offered, ask about something else.
- Never invent a line or trip, and never describe a made-up one ("a line with a Honolulu trip and a week of hub turns"). Name only lines and trips from the examples, the line pairs, or what they've already been shown. If no real line shows a trade, don't ask it.
- It moves the ranking: ask about trade-offs, thresholds and how much something matters relative to their other priorities — not trivia, not things a bid pack can't show, not things they already answered.
- Prefer open questions that let them tell you what they want, in their own words — including things the brain hasn't modelled yet. Most of the interview should be these.
- It is plain, and in the pack's words and pilots' (PILOT WORDS below), the way ASK IT THE WAY YOU'D SAY IT describes. Match their tone.
- Never re-ask a settled thread or a question already asked in any wording. If an answer was vague, at most one follow-up on that thread, then move on.
- Never follow a line choice with a made-up version of the same trade ("if a line had more weekends but a 4-day trip…") — their real choice already answered it.
- Numbers: when a priority's number is still fuzzy AND pinning it would change their ranking ("not too much credit", "a real break at home"), one question asking for the number is worth it — in their terms ("How many days in a row at home before it feels like a real break?"). For something they want less of, ask where it starts to cost them first ("How many commutes before it starts to bother you?"); where a line drops to the bottom of their list is its own next question, never folded into the first. Once they've given the numbers, don't ask about them again. Don't ask where a line becomes one they wouldn't bid at all ("too low to bid it") — the bottom-of-the-list question covers that, and asking again turns a preference into a rule.
- Commuters are asked separately, in two fixed questions, how much time they leave before a report and how many other flights they'd want. Never ask either.
- Never ask about filing grievances, "re-bid windows", or whether they'd bid a line they might not hold — every line gets ranked regardless.
- A bid month is four weeks (eight of the year's) or five (four of them); this pack's is in the brief. A line's last trip can run past its end into the next bid month: that carry-over ("C/O" in the pack) is the next month's, and every count here is the bid month's alone. Say a line "carries 6:08 C/O into November" or "runs two days into November" — never call it a "five-week line".

ASK IT THE WAY YOU'D SAY IT
The owner read a question that packed two lines, two kinds of deadhead, shortening a trip and "what would tip it" into one sentence, and couldn't follow it; the same thing said plainly was "WAY better". So:
- prompt is the plain question: one sentence a pilot would say out loud, about 20 words at most, asking ONE thing ("Would you rather have great layovers, or an easier commute?").
- helpText carries the details under it: the real lines or trips and their figures, as "for example", in a sentence or two.
- Never two questions in one ("…, and what would tip it?", "…, and how early do you leave?"). If both matter, ask the first; the second is the next question.
- Compare only real lines or trips, by number. Never set one against an imaginary one ("over one with weaker layovers").
- Times and lengths the way you'd say them: "lands just before 1 am", "sits about 2½ hours", not "00:59" or "2h36".
- More questions is fine when it keeps each one simple. Don't stack.
How the owner wants them to read:
- prompt "Which line would you bid higher: 1004 or 1024?" — helpText "1004 has only two departures and lots of time in cities you like, but it's hard on your body clock. 1024 has three trips that start with a deadhead you can catch from home, and it's easy on your body clock."
- prompt "How many days in a row at home do you need before it feels like a real break?" — helpText "For example, line 1011 gives you 16 days off in long stretches. Line 1013 gives you 15, but chopped up by short stays at home."
- prompt "Would you rather have great layovers, or an easier commute?" — helpText "Line 1005 has the best layovers in the pack, but you'd still commute to Memphis for its 11-day trip. Line 1024 has plainer layovers, but its trips start with a deadhead from LAX you could catch from home. Which would you bid higher?"

PILOT WORDS
Say things the way the pack prints them and a pilot says them. A word this pilot brought up themselves can be said back to them — if they call it a sign-in, say sign-in — but only because they said it. Their priorities' names and the fleet notes don't count as their words. Otherwise:
${pilotWordsForPrompt()}
Write as you'd say it out loud: whole, plain sentences, never a label and a number glued together, and never shorthand from a trip's summary ("×4 standby days" is "four standby days"). An example's figure already says what it counts ("1 commute", "4 long duty periods", "40% of the flying in daytime") — fold it into the sentence ("1008 takes one commute; 1032 takes five"), never "Fewer commutes: 1 commute". The same for the names of their priorities: they're written as wishes ("Avoid duty periods over 12 hours"), so talk about the thing itself ("long duty periods"), not the wish. A trip that saves the commute, the way a pilot puts it: "a trip that starts with a deadhead to LAX or somewhere in the Pacific, so you can skip Memphis and shorten it".

QUESTION KINDS
- free-text: the default. Open questions that let them explain.
- choice: when 2–4 concrete options make it quicker to answer (they can still add a note). Options must be mutually exclusive and in their terms.
- line-pair: when one of the offered line pairs would show how they weigh several of their priorities against each other. Set pairIndex to that pair's index. Each pair differs on 3–5 things they care about (listed with real numbers), each line winning some; the pilot sees both lines in full and that list of differences right under the question. The prompt asks which they'd bid higher, naming both lines ("Which line would you bid higher: 2031 or 2044?"); helpText says, in a sentence or two, the two or three differences that matter most to them, in their terms ("2031 pays more and keeps you to two commutes. 2044 has the weekends and the beach layovers."). A real choice teaches the ranking more than any description, but it's a tool, not the format: about one question in four, never more than one in three. Never offer the same pair twice.

PACING
- Never two line-pair questions in a row — a run of them feels like a quiz. Mix in their own words.
- After a line choice, if what tipped it isn't clear from their answer and it would change the ranking, one open follow-up on why is worth asking.
- In a monthly check-in (see PILOT), start with whatever they said has changed or is new this month, then this pack's own tensions; don't re-cover what last month's interview settled unless this pack makes it newly relevant.

FLEET NOTES
When given, they're anonymous patterns from other pilots in the same group. A topic pilots like this often care about, that this pilot hasn't touched, can be worth one question — asked about them, never asserted ("A lot of commuters here care about…" is fine; "You care about…" is not).

SETTLED
List the ids of every thread their latest answer resolved (or made moot).

BE THOROUGH
There is no target number of questions. A pilot who told a long, detailed story has a lot to pin down, and the interview takes the time to do it. For every criterion that matters to them (weight 0.3 or more) you want to know how it ranks against their other priorities, any number that defines it ("a real break" = how many days at home), and where it stops mattering. Criteria marked "not yet probed" are known only from their opening story — get to each of them before finishing, with a question or a line choice.

DONE
Set done only when every important criterion has been probed, no open thread would still change their ranking meaningfully, and their last answers stopped adding anything new — or when they've answered maxTurns questions. RANKING STABILITY (below) tells you how many of their top-10 lines each re-read changed; a stable top 10 is one signal, not the whole answer — with important criteria still unprobed there's more to learn. Don't stop while an important trade-off is still unknown.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["settled", "done", "reason", "threadId", "kind", "ack", "prompt", "helpText", "options", "pairIndex", "examples"],
  properties: {
    settled: { type: "array", items: { type: "string" }, description: "Thread ids the latest answer resolved." },
    done: { type: "boolean" },
    reason: { type: "string", description: "One line: why this question (or why done)." },
    threadId: { type: "string", description: "The thread this question explores; empty when it follows up on something new." },
    kind: { type: "string", enum: ["free-text", "choice", "line-pair"] },
    ack: { type: "string", description: "One short line (≤14 words) taking in their last answer, before the question. Empty on the first question or when done." },
    prompt: { type: "string", description: "The question, as the pilot will read it. Empty when done." },
    helpText: { type: "string", description: "Optional one-line hint under the question; empty for none." },
    options: { type: "array", items: { type: "string" }, description: "2–4 options for a choice question; empty otherwise." },
    pairIndex: { type: "integer", description: "The offered line pair for a line-pair question; -1 otherwise." },
    examples: { type: "array", items: { type: "string" }, description: "Ids from EXAMPLES YOU MAY SHOW, shown with the question: two lines of one priority, or one trip; empty for a line-pair question." },
  },
} as const;

interface RawStep {
  settled: string[];
  done: boolean;
  reason: string;
  threadId: string;
  kind: "free-text" | "choice" | "line-pair";
  ack: string;
  prompt: string;
  helpText: string;
  options: string[];
  pairIndex: number;
  examples: string[];
}

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
/** Line choices are at most about a third of the interview — open questions are where the pilot gets to say what they want. */
const MAX_PAIR_SHARE = 0.34;

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

/** A question about a made-up line or trip ("if a line instead had…", "say a trip…", "imagine a line…"). */
/** A real line set against one that doesn't exist: "would you take that over one with weaker layovers". */
const AGAINST_IMAGINED = /\b(?:over|than|instead of)\s+(?:one|a line|a trip|another line|another trip)\s+(?:with|that|where)\b/i;
/** A second question tacked on: "…, and what would tip it?", "…, and how early do you leave?" */
const THEN_ANOTHER = /[,;—–-]\s*(?:and|or)\s+(?:what|how|which|why|where|when|would|do|does|is|are)\b[^?]*\?\s*$/i;
/** Text that fixes itself as it goes: "…on 2043's side. Correction: 2043 has…" (a replayed turn, Nov 2026). */
const SELF_CORRECTION = /\b(?:correction|I mean|scratch that|sorry)\b\s*[:,—–-]/i;
/** One thing weighed against a list: "how much does it matter next to layovers and days off?" */
const WEIGHED_AGAINST_SEVERAL = /\b(?:next to|compared (?:to|with)|versus|vs\.?|against)\s+[^?]*?(?:,|\band\b)/i;
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
 *   example covers is shown bare, with no figure;
 * - lines in pairs, both ends of the priority — one 13-day line and a 13-day trip showed nothing to compare;
 * - lines or one trip, never both — unless it names the trip;
 * - only what the question's thread is about, besides what it names.
 */
function examplesToShow(step: Pick<RawStep, "prompt" | "helpText" | "examples" | "threadId">, input: Pick<InterviewStepInput, "examples" | "packNumbers" | "model">): QuestionExample[] {
  const all = input.examples ?? [];
  const offered = examplesFitting(step, input);
  const chosen = [...new Set(step.examples ?? [])].slice(0, 2).flatMap((id) => offered.filter((e) => e.id === id));
  const priorities = new Set(chosen.map(priorityOf));
  const lines = chosen.filter((e) => e.kind === "line");
  const add = (e: QuestionExample | undefined) => {
    if (e && lines.length < 3 && !lines.some((x) => x.ref === e.ref)) lines.push(e);
  };
  // A named line's example comes from the shown priority where there is one, then the question's, then any.
  for (const n of namedPackLines(step, input)) {
    if (lines.some((x) => x.ref === n)) continue;
    const ofLine = (pool: QuestionExample[]) => pool.filter((e) => e.kind === "line" && e.ref === n);
    add(ofLine(offered).find((x) => priorities.has(priorityOf(x))) ?? ofLine(offered)[0] ?? ofLine(all)[0] ?? { id: `L${n}`, kind: "line", ref: n, title: `Line ${n}`, fact: "", summary: "" });
  }
  if (lines.length === 1) add(otherEnd(lines[0], offered));
  const trips = namedTripExamples(step, all).flatMap((t) => (t.example ? [t.example] : []));
  if (lines.length) return [...lines, ...trips.slice(0, 1)];
  return [...trips, ...chosen.filter((e) => e.kind === "trip")].slice(0, 1);
}

/** Why a proposed question can't be asked, if it can't. `attempt` counts proposals this turn (0 = the first). */
function rejection(step: RawStep, input: InterviewStepInput, pairsUsed: Set<string>, attempt = 0): string | null {
  if (step.done) return null;
  if (!step.prompt.trim()) return "The question was empty.";
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
  if (attempt === 0 && step.kind !== "line-pair") {
    const shown = (step.examples ?? []).flatMap((id) => (input.examples ?? []).filter((e) => e.id === id));
    const lines = shown.filter((e) => e.kind === "line");
    const other = lines.length === 1 ? otherEnd(lines[0], input.examples ?? []) : undefined;
    if (other) return `Lines are shown in pairs, the two ends of the priority: show ${other.id} (${other.title} — ${other.fact}) with ${lines[0].id} and name both.`;
    if (lines.length && shown.some((e) => e.kind === "trip")) return "Show lines or one trip, not both: the two lines already show it.";
  }
  // A trip it names is the one it shows — "trip 97 goes to IND" came with two lines and no trip 97.
  if (step.kind !== "line-pair" && attempt < 2) {
    const chosen = new Set(step.examples ?? []);
    const unshown = namedTripExamples(step, examplesFitting(step, input)).find((t) => !t.example || !chosen.has(t.example.id));
    if (unshown) return `You name trip ${unshown.n} but don't show it. Show the trip you name, from the examples of what this question is about, and nothing else — or leave it out.`;
  }
  // Every line it names is shown under it (see `examplesToShow`); a line with no example to show can't be named.
  if (step.kind !== "line-pair" && attempt < 2) {
    const unseen = namedPackLines(step, input).find((n) => !examplesFitting(step, input).some((e) => e.kind === "line" && e.ref === n));
    if (unseen) return `Line ${unseen} isn't among the examples of what this question is about, so the pilot couldn't see it — name only lines you show.`;
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
  if (step.kind !== "line-pair" && (HYPOTHETICAL.test(`${step.prompt} ${step.helpText}`) || AGAINST_IMAGINED.test(step.prompt)))
    return "That describes a made-up line or trip. Ask about the real lines or trips in the examples, or offer a line pair.";
  // One plain question, details under it — the owner couldn't follow one that stacked several (Nov 2026). Not on the
  // last try: a long question mustn't end the interview.
  if (attempt < 2 && (step.prompt.match(/\?/g) ?? []).length > 1) return "That asks more than one thing. Ask the first as its own plain question; the other can be the next question.";
  if (attempt < 2 && THEN_ANOTHER.test(step.prompt)) return "That asks two things in one (\"…, and what would…\"). Ask the first on its own; the other can be the next question.";
  if (attempt < 2 && SELF_CORRECTION.test(`${step.prompt} ${step.helpText}`)) return "That corrects itself partway (\"Correction: …\"). Write it once, the right way.";
  if (attempt < 2 && WEIGHED_AGAINST_SEVERAL.test(step.prompt)) return "That weighs one thing against several (\"next to layovers and days off\"). Ask about the one thing on its own; to weigh several, offer a line pair.";
  if (attempt < 2 && step.prompt.split(/\s+/).length > MAX_PROMPT_WORDS) return `Put the question in one plain sentence of ${MAX_PROMPT_WORDS} words or fewer, and the lines and figures in helpText.`;
  // Show, don't ask in the abstract — once: a question no example fits may still go without one.
  if (attempt === 0 && step.kind !== "line-pair" && !(step.examples ?? []).length && offered.size)
    return "Show the EXAMPLES YOU MAY SHOW of this question's priority with it (set examples and name them with their figure) — but only if a group shows exactly what you're asking. If none does, ask it again as it is, with no examples.";
  const t = step.threadId ? input.threads[step.threadId] : undefined;
  if (t && t.status !== "open") return `Thread ${step.threadId} is ${t.status} — don't ask about it again.`;
  if (t && t.timesAsked >= 2) return `Thread ${step.threadId} has already been asked twice — move on.`;
  const asked = new Set(input.exchanges.map((e) => norm(e.question)));
  if (asked.has(norm(step.prompt))) return "That exact question was already asked.";
  if (step.kind === "line-pair") {
    const isPair = (e: InterviewExchange) => LINE_PAIR_QUESTION.test(e.question);
    const last = input.exchanges.at(-1);
    if (last && isPair(last)) return "The last question was a line choice — ask something in their own words this time.";
    // About one in three, once the interview is under way: a line choice is a tool, not the format.
    // This session's own questions — `turn` counts them; a monthly check-in's transcript starts with last month's.
    const interview = input.turn > 0 ? input.exchanges.slice(-input.turn) : [];
    const pairsSoFar = interview.filter(isPair).length;
    if (interview.length >= 4 && (pairsSoFar + 1) / (interview.length + 1) > MAX_PAIR_SHARE) return "Line choices are already about a third of the questions — ask something else.";
    const pair = input.linePairs.find((p) => p.index === step.pairIndex);
    if (!pair) return "That line pair index doesn't exist.";
    if (pairsUsed.has(`${pair.a}|${pair.b}`) || pairsUsed.has(`${pair.b}|${pair.a}`)) return "Those two lines were already compared.";
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
    const shown = kind === "line-pair" ? [] : examplesToShow(step, input);
    return {
      done: false,
      settled,
      threadId: step.threadId || null,
      kind,
      // A reply still stating a limit they didn't give is left out: better no reply than a rule they never set.
      ...((step.ack ?? "").trim() && input.turn > 0 && !inventedLimit(step.ack, input.exchanges.at(-1)?.answer ?? "") ? { ack: step.ack.trim() } : {}),
      prompt: step.prompt.trim(),
      ...(step.helpText.trim() ? { helpText: step.helpText.trim() } : {}),
      ...(kind === "choice" ? { options } : {}),
      ...(pair ? { pair } : {}),
      // The examples go into the transcript after the question (and its options), so the brain reads what was shown.
      ...(shown.length ? { examples: shown, transcript: `${step.prompt.trim()}${examplesTranscript(shown)}` } : {}),
      usage,
    };
  }
  // Three proposals in a row couldn't be asked: the interview has run out of new ground.
  return { done: true, reason: "No new question left to ask.", settled: [], usage };
}
