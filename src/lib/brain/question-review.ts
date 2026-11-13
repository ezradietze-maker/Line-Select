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
}

export interface Review {
  ok: boolean;
  /** The one thing to fix, said to the interviewer; empty when ok. */
  problem: string;
  usage: BrainUsage;
}

const SYSTEM = `You check one interview question before a FedEx line pilot sees it. Another assistant wrote it to learn how this pilot ranks their monthly lines. Read it as a line pilot would, against the facts given, and pass it unless one of these is plainly wrong:

1. A figure or claim in the question or its help text contradicts the FACTS for the line or trip it's about (a show time, a count, credit, a city put on the wrong line or trip). Ignore figures the facts don't cover — only contradictions count.
2. The lines or trips shown don't show what the question asks about (a question about layovers shown with lines picked for their departures).
3. The help text wanders onto a second topic the question doesn't ask about.
4. It asks how they feel about something their answers already say plainly, with nothing left open, or for a number their answers already give ("three or four days at home"). Asking what their own words meant, or for a number they haven't given, is fine.
5. It asks the same thing as an earlier question, in other words.
6. A line pilot couldn't tell in one read what's being asked.
7. It reads like a form, not one pilot talking to another: their own phrase repeated back clumsily ("You said you want big blocks of days off. How many nights at home in a row make a big block?" should be "You said you prefer several days off in a row. How many nights at home would that be?"), or a vague "What is it about…?".
9. The help text doesn't make common sense to a pilot: a list of figures instead of the lines' features, or a measurement no pilot counts on a line — an hours total ("5.1 hours after midnight", "138 hours in cities you like"), a score ("33/100"), a percentage. Days off, trips, departures, credit, days in a trip, long duty periods and early shows are fine; "less night flying", "easier on the body clock" is how it should read.
8. It asks where more of something every pilot wants stops mattering, or how much is "enough" (days off, nights at home, credit, layover time) — what's worth knowing is what they'd give up for it.

Be lenient: pass anything a pilot would understand and that isn't wrong. When something is wrong, say the one thing to fix in a sentence addressed to the writer ("The help text says 2014 shows at 8:58 am, but that's 2020's trip; 2014 shows at 9:50 pm.").`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "problem"],
  properties: {
    ok: { type: "boolean" },
    problem: { type: "string", description: "The one thing to fix, in a sentence; empty when ok." },
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

const MAX_TOKENS = 600;

/**
 * The most one review can cost. What it reads is kept short (`recent`), but the facts for what's shown come from the
 * request, so they're counted at their longest: a few examples and a pair, each summary up to 2,000 characters.
 */
export function reviewCeilingUsd(): number {
  return callCeilingUsd(REVIEW_MODEL, SYSTEM.length + schemaChars(SCHEMA) + 6000 + 3000 + 30_000, MAX_TOKENS);
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
  const r = await structuredCall<{ ok: boolean; problem: string }>({ apiKey: input.apiKey, model: REVIEW_MODEL, system: SYSTEM, user: { fresh: user }, schema: SCHEMA as unknown as Record<string, unknown>, effort: "low", maxTokens: MAX_TOKENS });
  return { ok: r.data.ok || !r.data.problem.trim(), problem: r.data.problem.trim(), usage: r.usage };
}
