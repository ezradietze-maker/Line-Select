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

/** Two real lines from the pack that pull this pilot's priorities against each other — offered to the interviewer, which may ask the pilot to choose. */
export interface LinePairCandidate {
  index: number;
  a: string;
  b: string;
  /** Which two criteria the pair pits against each other (sorted ids) — so the same trade isn't asked over and over. */
  trade: string;
  /** What each line wins on, in real numbers. */
  tension: string;
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
  apiKey?: string;
}

export type InterviewStep =
  | { done: true; reason: string; settled: string[]; usage?: BrainUsage }
  | {
      done: false;
      settled: string[];
      threadId: string | null;
      kind: "free-text" | "choice" | "line-pair";
      prompt: string;
      helpText?: string;
      options?: string[];
      pair?: LinePairCandidate;
      usage?: BrainUsage;
    };

const SYSTEM = `You are interviewing a FedEx pilot about how they bid their monthly lines, on behalf of a bidding assistant. A separate "brain" has read everything they've said and keeps a model of them: criteria (what they care about, each measured on their real bid pack, with a weight) and threads (open questions whose answers would change their ranking). You choose the ONE next question — or decide the interview is done.

WHAT MAKES A GOOD QUESTION
- It comes from them: one of the open threads (prefer the highest priority one), or something in their latest answer worth one follow-up. Quote or echo their own words. Never ask a generic checklist question about a topic they haven't raised — topics they never mentioned are covered later on a separate screen.
- It is grounded in their pack: use the real cities, numbers and lines in the pack brief ("Sydney only shows up on 4 lines here, and two of them…").
- It moves the ranking: ask about trade-offs, thresholds and how much something matters relative to their other priorities — not trivia, not things a bid pack can't show, not things they already answered.
- It is short (one or two sentences), plain, and in pilot terms (deadhead, layover, duty period, report, block, credit, TAFB, secondary line, jumpseat). Match their tone.
- Never re-ask a settled thread or a question already asked in any wording. If an answer was vague, at most one follow-up on that thread, then move on.
- Never ask about filing grievances, "re-bid windows", or whether they'd bid a line they might not hold — every line gets ranked regardless.

QUESTION KINDS
- free-text: the default. Open questions that let them explain.
- choice: when 2–4 concrete options make it quicker to answer (they can still add a note). Options must be mutually exclusive and in their terms.
- line-pair: when the open question is how they trade one priority against another, and one of the offered line pairs shows exactly that trade. Set pairIndex to that pair's index and write the prompt around the trade ("Line 1011 has your double deadhead but two two-leg duties; line 1018 is all single legs but you commute twice — which would you bid?"). Use line pairs often once the main priorities are known — a real choice teaches more than any description. Never offer the same pair twice.

SETTLED
List the ids of every thread their latest answer resolved (or made moot).

DONE
Set done when no open thread would still change their ranking meaningfully, when their last answers stopped adding anything new, or when they've answered maxTurns questions. Don't drag it out; don't stop while an important trade-off is still unknown.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["settled", "done", "reason", "threadId", "kind", "prompt", "helpText", "options", "pairIndex"],
  properties: {
    settled: { type: "array", items: { type: "string" }, description: "Thread ids the latest answer resolved." },
    done: { type: "boolean" },
    reason: { type: "string", description: "One line: why this question (or why done)." },
    threadId: { type: "string", description: "The thread this question explores; empty when it follows up on something new." },
    kind: { type: "string", enum: ["free-text", "choice", "line-pair"] },
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
  prompt: string;
  helpText: string;
  options: string[];
  pairIndex: number;
}

function renderModel(model: PilotModel | null, threads: Record<string, ThreadState>): string {
  if (!model) return "(The brain hasn't read them yet — start from their own words below.)";
  const crit = [...model.criteria]
    .sort((a, b) => b.weight - a.weight)
    .map((c) => `- ${c.label} [${c.metric}] weight ${c.weight.toFixed(2)}, confidence ${c.confidence.toFixed(2)}`)
    .join("\n");
  const open = model.threads
    .map((t) => ({ ...t, ...threads[t.id] }))
    .map((t) => `- id=${t.id} [${t.status}${t.timesAsked ? `, asked ${t.timesAsked}×` : ""}] priority ${t.priority.toFixed(2)}: ${t.topic} — ${t.why}`)
    .join("\n");
  return [`SYNOPSIS: ${model.synopsis}`, `CRITERIA:\n${crit || "(none yet)"}`, `THREADS:\n${open || "(none)"}`, model.notMeasurable.length ? `NOT MEASURABLE (kept, never asked about): ${model.notMeasurable.map((n) => n.statement).join("; ")}` : ""]
    .filter(Boolean)
    .join("\n\n");
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
    const pair = input.linePairs.find((p) => p.index === step.pairIndex);
    if (!pair) return "That line pair index doesn't exist.";
    if (pairsUsed.has(`${pair.a}|${pair.b}`) || pairsUsed.has(`${pair.b}|${pair.a}`)) return "Those two lines were already compared.";
  }
  return null;
}

export async function nextInterviewStep(input: InterviewStepInput): Promise<InterviewStep> {
  const conversation = input.exchanges.map((e) => `[${e.turn}] Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  const pairsUsed = new Set(input.exchanges.flatMap((e) => [...e.question.matchAll(/Line (\d{3,5}) vs Line (\d{3,5})/g)].map((m) => `${m[1]}|${m[2]}`)));
  const pairs = input.linePairs.length
    ? input.linePairs.map((p) => `#${p.index}: Line ${p.a} vs Line ${p.b} — ${p.tension}\n   ${p.a}: ${p.summaryA}\n   ${p.b}: ${p.summaryB}`).join("\n")
    : "(none offered this turn)";
  let fresh = [
    `PILOT: ${input.pilotContext}`,
    `THE BRAIN'S CURRENT MODEL OF THEM:\n${renderModel(input.model, input.threads)}`,
    `LINE PAIRS YOU MAY OFFER:\n${pairs}`,
    `THE INTERVIEW SO FAR (${input.turn} of at most ${input.maxTurns} questions answered):\n\n${conversation}`,
    `Choose the next question, or decide the interview is done.`,
  ].join("\n\n");

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
