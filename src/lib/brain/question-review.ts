import { PASS, SEND_BACK } from "./review-examples";
import { callCeilingUsd, schemaChars, structuredCall, type BrainUsage } from "./llm";

/**
 * A second, cheaper reader for every question the interviewer writes, before the pilot sees it. The interviewer's
 * checks catch what a pattern can: banned words, made-up lines, two asks, trades in words. What they can't catch is
 * meaning — a figure put on the wrong line ("2014 shows at 08:58" when it's 2020's trip that does), help text that
 * drifts onto another topic, lines shown that have nothing to do with the question, or a "how do you feel about it" on
 * something the pilot already said plainly. A line pilot reading it would catch those at once, so a model reads it the
 * way one would, against the facts the app has for what's on screen, and sends it back with the one thing to fix.
 */

export const REVIEW_MODEL = process.env.QUESTION_REVIEW_MODEL || "claude-haiku-5-5";

export interface QuestionForReview {
  prompt: string;
  helpText: string;
  options: string[];
  questionKind: string;
  /** What the app said is unclear about the topic, when there is one ("how much it matters", "their number"). */
  topic?: string;
  /** The facts the app has for each line or trip shown with it, one per entry. */
  facts: string[];
}

export interface ReviewInput {
  question: QuestionForReview;
  /** Everything the pilot has said, oldest first. */
  answers: string[];
  /** The questions already asked, oldest first. */
  asked: string[];
  apiKey?: string;
  /** Another model to review with — for the test bench (scripts/eval/review-bench.ts). */
  model?: string;
}

export interface Review {
  ok: boolean;
  /** The one thing to fix, said to the interviewer; empty when ok. */
  problem: string;
  /** The question as it should read, for the interviewer to use; empty when ok. */
  rewrite: string;
  usage: BrainUsage;
}

const SYSTEM = `You check one interview question before a FedEx line pilot sees it. Another assistant wrote it to learn how this pilot ranks their monthly lines. The test: would a line pilot read it once and know exactly what's being asked, and does it sound like one pilot asking another? Send it back only when you can name what's wrong:

A. Hard to read: you'd have to read it twice; doubled-up phrasing ("how much does catching it from LAX change how much you like the trip"); a long lead-in that isn't the question; technical wording ("first operated leg"); options that don't answer the question as asked.
B. Leading or vague: it assumes something bothers them ("What bothers you most about…"), asks "What is it about…?", or points at a line without saying what's on it ("an example of the kind of line you've been weighing").
C. It asks where more of something every pilot wants stops helping, or what's "plenty", "enough" or "clearly better" — days off, nights at home, credit, full days off on layovers. An ideal number of something they want less of (departures, long duty periods) is fine.
D. Line or trip descriptions a pilot can't follow: a measurement no pilot counts (an hours total like "5.1 hours after midnight" or "7 hours in cities you like", a score like "33/100", a percentage), a count no one could have ("about 1.5 takeoffs"), an app phrase ("no real night", "duties through the night", "runs of 3+ nights"), so much on one line that it reads as a list, or a "but" that doesn't contrast. Days off, trips, departures, credit, days in a trip, long duty periods and early shows are fine, and so are features said plainly ("less night flying", "easier on the body clock") and pilots' own terms ("the backside of the clock", "hub turns", "deadhead").
E. Two questions in one.
F. A figure contradicts the FACTS given (a show time, a count or a city on the wrong line). When no facts are given, say nothing about figures.
G. It repeats an earlier question, or asks for a number or a feeling their answers already give. When nothing they've said is shown, take any "You said…" as accurate.

The owner's own calls — send back questions like these:
${SEND_BACK.map((x) => `- "${x.question}" — ${x.why}`).join("\n")}

Pass questions like these:
${PASS.map((x) => `- "${x}"`).join("\n")}

Pass everything else: a question doesn't have to be perfect, only clear and natural. When you send one back, say in one sentence what's wrong, and write it the way it should read — the question, and the help text when that's what's wrong.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "problem", "rewrite"],
  properties: {
    ok: { type: "boolean" },
    problem: { type: "string", description: "The one thing to fix, in a sentence; empty when ok." },
    rewrite: { type: "string", description: "The question as it should read (and its help text, when that's what's wrong); empty when ok." },
  },
} as const;

/** Keep the pilot's words and the earlier questions to what the check needs. */
const recent = (xs: string[], chars: number) => {
  const out: string[] = [];
  let used = 0;
  for (const x of [...xs].reverse()) {
    if (used + x.length > chars) break;
    out.unshift(x);
    used += x.length;
  }
  return out;
};

const MAX_TOKENS = 1500;

/**
 * The most one review can cost. What it reads is kept short (`recent`), but the facts for what's shown come from the
 * request, so they're counted at their longest: a few examples and a pair, each summary up to 2,000 characters.
 */
export function reviewCeilingUsd(): number {
  const read = SYSTEM.length + schemaChars(SCHEMA) + 6000 + 3000 + 30_000;
  // A question sent back also gets its fix written, by the stronger model.
  return callCeilingUsd(REVIEW_MODEL, read, MAX_TOKENS) + callCeilingUsd(REWRITE_MODEL, read + REWRITE_SYSTEM.length + schemaChars(REWRITE_SCHEMA), MAX_TOKENS);
}

export async function reviewQuestion(input: ReviewInput): Promise<Review> {
  const q = input.question;
  const user = [
    `QUESTION (${q.questionKind}${q.topic ? `, about: ${q.topic}` : ""}): ${q.prompt}`,
    q.helpText ? `HELP TEXT: ${q.helpText}` : "",
    q.options.length ? `OPTIONS: ${q.options.join(" / ")}` : "",
    `FACTS FOR WHAT'S SHOWN:\n${q.facts.length ? q.facts.map((f) => `- ${f}`).join("\n") : "(nothing shown with it)"}`,
    `WHAT THE PILOT HAS SAID:\n${recent(input.answers, 6000).map((a) => `- ${a}`).join("\n") || "(nothing yet)"}`,
    `QUESTIONS ALREADY ASKED:\n${recent(input.asked, 3000).map((a) => `- ${a}`).join("\n") || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await structuredCall<{ ok: boolean; problem: string; rewrite?: string }>({ apiKey: input.apiKey, model: input.model ?? REVIEW_MODEL, system: SYSTEM, user: { fresh: user }, schema: SCHEMA as unknown as Record<string, unknown>, effort: "low", maxTokens: MAX_TOKENS });
  const ok = r.data.ok || !r.data.problem.trim();
  const problem = r.data.problem.trim();
  if (ok) return { ok, problem, rewrite: "", usage: r.usage };
  // Sent back: the stronger model writes the fix. On the owner's test set (Nov 2026) the cheap model was the better
  // judge — it sent back far fewer good questions — but its rewrites were weak (two asks in one, a made-up line), and
  // the stronger model's read the way the owner wants. A failed rewrite still sends the question back, with the reason.
  const fix = await structuredCall<{ rewrite: string }>({
    apiKey: input.apiKey,
    model: REWRITE_MODEL,
    system: REWRITE_SYSTEM,
    user: { fresh: `${user}\n\nWHAT'S WRONG: ${problem}` },
    schema: REWRITE_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
    maxTokens: MAX_TOKENS,
  }).catch(() => null);
  const usage = fix ? { ...r.usage, costUsd: r.usage.costUsd + fix.usage.costUsd, ms: r.usage.ms + fix.usage.ms } : r.usage;
  return { ok, problem, rewrite: (fix?.data.rewrite ?? r.data.rewrite ?? "").trim(), usage };
}

/** Writes the fix for a question the reviewer sent back. */
export const REWRITE_MODEL = process.env.QUESTION_REWRITE_MODEL || "claude-sonnet-5-5";

const REWRITE_SYSTEM = `You rewrite one interview question a reviewer sent back, so a FedEx line pilot understands it in one read and it sounds like one pilot asking another. Keep what it's asking about and the real lines or trips it names; fix only what's wrong. One question, one ask. Name features plainly ("less night flying", "easier on the body clock", "three full days in Honolulu"), with numbers only where a pilot counts them (days off, trips, departures, credit, days in a trip, long duty periods, early shows). Never invent a line or trip, never ask two things, never ask where more of something every pilot wants stops mattering.

Questions the owner approved, for the voice:
${PASS.map((x) => `- "${x}"`).join("\n")}

Write the question, then its help text after " — help text: " when it has one, then its options after " (options: … / …)" when it has them.`;

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rewrite"],
  properties: { rewrite: { type: "string" } },
} as const;
