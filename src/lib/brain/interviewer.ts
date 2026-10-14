import type { PilotModel } from "@/types/pilot-model";
import type { InterviewExchange } from "./build-model";
import { structuredCall, type BrainUsage } from "./llm";

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
      /** For the fixed priority-order question: the criterion behind each option (see `priority-order.ts`). */
      priorityIds?: string[];
      /** How the question goes into the transcript when it differs from the prompt (e.g. with its options). */
      transcript?: string;
      /** For a bid check: the line asked about and the line its verdict is recorded against (see `bid-check.ts`). */
      bidCheck?: { line: string; alt: string; kind?: "top" | "middle" };
      usage?: BrainUsage;
    };

const SYSTEM = `You are interviewing a FedEx pilot about how they bid their monthly lines, on behalf of a bidding assistant. A separate "brain" has read everything they've said and keeps a model of them: criteria (what they care about, each measured on their real bid pack, with a weight) and threads (open questions whose answers would change their ranking). You choose the ONE next question — or decide the interview is done.

SOUND LIKE A PILOT, NOT A FORM
You're a line pilot who has bid for years, talking to a colleague — not a survey. Before each question, write ack: one short line (at most 14 words) that takes in what they just said, in their terms, like you'd say it across the crew room ("Saturdays over Sundays — got it." / "So the 9-day block wins when it's a real block."). No praise ("Great answer", "Thanks for sharing"), no "I understand", no repeating their whole answer. Leave ack empty for the very first question. Vary how questions open — never start two in a row the same way, and don't fall into a template ("Line X has…, line Y has…, which would you bid?" every time).

WHAT MAKES A GOOD QUESTION
- It comes from them: one of the open threads (prefer the highest priority one), or something in their latest answer worth one follow-up. Quote or echo their own words. Never ask a generic checklist question about a topic they haven't raised — topics they never mentioned are covered later on a separate screen.
- It is grounded in their pack: use the real cities, numbers and lines in the pack brief ("Sydney only shows up on 4 lines here, and two of them…").
- It moves the ranking: ask about trade-offs, thresholds and how much something matters relative to their other priorities — not trivia, not things a bid pack can't show, not things they already answered.
- Prefer open questions that let them tell you what they want, in their own words — including things the brain hasn't modelled yet. Most of the interview should be these.
- It is short (one or two sentences), plain, and in pilot terms (deadhead, layover, duty period, report, block, credit, TAFB, secondary line, jumpseat). Match their tone.
- Never re-ask a settled thread or a question already asked in any wording. If an answer was vague, at most one follow-up on that thread, then move on.
- Never follow a line choice with a made-up version of the same trade ("if a line had more weekends but a 4-day trip…") — their real choice already answered it.
- Numbers: when a priority's number is still fuzzy AND pinning it would change their ranking ("not too much credit", "a real block of days off"), one question asking for the number is worth it — in their terms ("How many days in a row before it feels like a real block?"). For something they want less of, ask for both ends in that one question: where it starts to cost them, and where a line becomes one they'd hardly bid ("How many commutes before it starts to bother you — and how many before you'd hardly bid the line?"). One number alone gets read as both. Once they've given the numbers, don't ask about them again. Don't ask where a line becomes one they wouldn't bid at all ("too low to bid it") — the Dealbreakers question covers what's absolute, and asking again turns a preference into a rule.
- Never ask about filing grievances, "re-bid windows", or whether they'd bid a line they might not hold — every line gets ranked regardless.

QUESTION KINDS
- free-text: the default. Open questions that let them explain.
- choice: when 2–4 concrete options make it quicker to answer (they can still add a note). Options must be mutually exclusive and in their terms.
- line-pair: when one of the offered line pairs would show how they weigh several of their priorities against each other. Set pairIndex to that pair's index. Each pair differs on 3–5 things they care about (listed with real numbers), each line winning some; the pilot sees both lines in full and that list of differences right under the question. The prompt names the two or three differences that matter most to them, in their terms, and asks which they'd bid higher — at most 40 words ("2031 pays more and keeps you to two commutes; 2044 has the weekends and the beach layovers. Which goes higher on your bid?"). A real choice teaches the ranking more than any description, but it's a tool, not the format: about one question in four, never more than one in three. Never offer the same pair twice.

PACING
- Never two line-pair questions in a row — a run of them feels like a quiz. Mix in their own words.
- After a line choice, if what tipped it isn't clear from their answer and it would change the ranking, one open follow-up on why is worth asking.
- A "Bid check" question asks whether a line near the top of their ranking really belongs there. If they say it doesn't and didn't say why, ask once what rules it out.
- In a monthly check-in (see PILOT), start with whatever they said has changed or is new this month, then this pack's own tensions; don't re-cover what last month's interview settled unless this pack makes it newly relevant.

FLEET NOTES
When given, they're anonymous patterns from other pilots in the same group. A topic pilots like this often care about, that this pilot hasn't touched, can be worth one question — asked about them, never asserted ("A lot of commuters here care about…" is fine; "You care about…" is not).

SETTLED
List the ids of every thread their latest answer resolved (or made moot).

BE THOROUGH
There is no target number of questions. A pilot who told a long, detailed story has a lot to pin down, and the interview takes the time to do it. For every criterion that matters to them (weight 0.3 or more) you want to know how it ranks against their other priorities, any number that defines it ("a real block" = how many days), and where it stops mattering. Criteria marked "not yet probed" are known only from their opening story — get to each of them before finishing, with a question or a line choice.

DONE
Set done only when every important criterion has been probed, no open thread would still change their ranking meaningfully, and their last answers stopped adding anything new — or when they've answered maxTurns questions. RANKING STABILITY (below) tells you how many of their top-10 lines each re-read changed; a stable top 10 is one signal, not the whole answer — with important criteria still unprobed there's more to learn. Don't stop while an important trade-off is still unknown.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["settled", "done", "reason", "threadId", "kind", "ack", "prompt", "helpText", "options", "pairIndex"],
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

/** Why a proposed question can't be asked, if it can't. */
function rejection(step: RawStep, input: InterviewStepInput, pairsUsed: Set<string>): string | null {
  if (step.done) return null;
  if (!step.prompt.trim()) return "The question was empty.";
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
export const SWEEP_QUESTION = "Anything else that matters when you bid? (Topics you hadn't raised.)";

/**
 * Questions before a settled ranking may end the interview on its own: more for a pilot with more that matters to them —
 * a long story with a dozen priorities needs more questions than a short one with four. Not a target; the interviewer
 * usually goes on past it.
 */
export function minTurnsFor(model: PilotModel | null): number {
  const important = (model?.criteria ?? []).filter((c) => c.weight >= 0.3).length;
  return Math.max(12, Math.min(28, 4 + 2 * important));
}

/**
 * The answers have stopped moving the ranking: the last two re-reads each changed at most one of the pilot's top-10
 * lines, every important criterion has been asked about, and nothing important is still wide open. More questions
 * from here cost the pilot time and teach little.
 */
export function rankingHasSettled(input: Pick<InterviewStepInput, "turn" | "rankingShifts" | "model" | "threads" | "exchanges">): boolean {
  const shifts = input.rankingShifts ?? [];
  // Right after the "anything else?" screen they may have just raised something new — it gets its follow-ups first.
  if (input.exchanges.at(-1)?.question === SWEEP_QUESTION) return false;
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
    input.rankingShifts?.length ? `RANKING STABILITY — top-10 lines changed by each re-read, oldest first: ${input.rankingShifts.join(", ")}` : "",
    `THE INTERVIEW SO FAR (${input.turn} of at most ${input.maxTurns} questions answered):\n\n${conversation}`,
    `Choose the next question, or decide the interview is done.`,
  ].filter(Boolean).join("\n\n");

  let usage: BrainUsage | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await structuredCall<RawStep>({ apiKey: input.apiKey, model: INTERVIEWER_MODEL, system: SYSTEM, user: { cached: input.packBrief, fresh }, schema: SCHEMA as unknown as Record<string, unknown>, effort: "medium", maxTokens: 4000 });
    usage = usage ? { ...r.usage, costUsd: usage.costUsd + r.usage.costUsd, ms: usage.ms + r.usage.ms } : r.usage;
    const step = r.data;
    const known = new Set(Object.keys(input.threads));
    const settled = step.settled.filter((id) => known.has(id) || input.model?.threads.some((t) => t.id === id));
    if (step.done || input.turn >= input.maxTurns) return { done: true, reason: step.reason, settled, usage };
    const why = rejection(step, input, pairsUsed);
    if (why) {
      fresh += `\n\nYour last proposal can't be used: ${why} Choose a different question.`;
      continue;
    }
    const pair = step.kind === "line-pair" ? input.linePairs.find((p) => p.index === step.pairIndex) : undefined;
    const options = step.options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
    const kind = step.kind === "choice" && options.length < 2 ? "free-text" : step.kind;
    return {
      done: false,
      settled,
      threadId: step.threadId || null,
      kind,
      ...((step.ack ?? "").trim() && input.turn > 0 ? { ack: step.ack.trim() } : {}),
      prompt: step.prompt.trim(),
      ...(step.helpText.trim() ? { helpText: step.helpText.trim() } : {}),
      ...(kind === "choice" ? { options } : {}),
      ...(pair ? { pair } : {}),
      usage,
    };
  }
  // Three proposals in a row couldn't be asked: the interview has run out of new ground.
  return { done: true, reason: "No new question left to ask.", settled: [], usage };
}
