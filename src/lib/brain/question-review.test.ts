import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { system: string; user: { fresh: string } }[] = [];
let answer = { ok: true, problem: "" };
/** What each call does in turn: undefined answers, an Error fails. */
const failures: (Error | undefined)[] = [];
vi.mock("@/lib/brain/llm", () => ({
  structuredCall: vi.fn(async (opts: { system: string; user: { fresh: string } }) => {
    calls.push(opts);
    const failure = failures.shift();
    if (failure) throw failure;
    return { data: answer, usage: { model: "h", inputTokens: 0, outputTokens: 0, costUsd: 0.001, ms: 2 } };
  }),
  failedCallCost: (e: { usage?: { costUsd?: number } }) => e?.usage?.costUsd ?? 0,
}));

import { reviewQuestion } from "@/lib/brain/question-review";

const question = { prompt: "Which line would you bid higher: 2014 or 2020?", helpText: "2014 shows at 8:58 am.", options: [], questionKind: "real-choice", facts: ["Line 2014: one 13-day trip, 21:50 show", "Line 2020: two trips, 08:58 show"] };

describe("the second reader", () => {
  beforeEach(() => {
    calls.length = 0;
    failures.length = 0;
    answer = { ok: true, problem: "" };
  });

  it("counts a rewrite that failed after it was paid for", async () => {
    answer = { ok: false, problem: "That's 2020's show time." };
    failures.push(undefined, Object.assign(new Error("brain call ran out of room"), { usage: { model: "s", inputTokens: 0, outputTokens: 1500, costUsd: 0.02, ms: 2 } }));
    const review = await reviewQuestion({ question, answers: [], asked: [] });
    expect(review).toMatchObject({ ok: false, problem: "That's 2020's show time." });
    expect(review.usage.costUsd).toBeCloseTo(0.021, 6);
  });

  it("reads the question against the facts for what's shown, what they've said and what was asked", async () => {
    await reviewQuestion({ question, answers: ["Fewest trips possible."], asked: ["How many nights at home make a real break?"] });
    const sent = calls[0].user.fresh;
    expect(sent).toContain("HELP TEXT: 2014 shows at 8:58 am.");
    expect(sent).toContain("- Line 2020: two trips, 08:58 show");
    expect(sent).toContain("- Fewest trips possible.");
    expect(sent).toContain("- How many nights at home make a real break?");
    expect(calls[0].system).toContain("contradicts the FACTS");
  });

  it("passes the question unless it names something to fix", async () => {
    answer = { ok: false, problem: "" };
    expect((await reviewQuestion({ question, answers: [], asked: [] })).ok).toBe(true);
    answer = { ok: false, problem: "That's 2020's show time." };
    expect(await reviewQuestion({ question, answers: [], asked: [] })).toMatchObject({ ok: false, problem: "That's 2020's show time." });
  });
});
