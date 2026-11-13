import { describe, expect, it } from "vitest";
import { restoreBack, saveBack, type Snapshot } from "@/lib/brain/interview-back";
import { fitExchanges, MAX_ANSWER } from "@/lib/brain/answer-limits";
import type { PilotModel } from "@/types/pilot-model";

const ex = (n: number) => Array.from({ length: n }, (_, i) => ({ turn: i, question: `Q${i}`, answer: `A${i}` }));
const model = (tag: string) => ({ version: 2, criteria: [], threads: [], notMeasurable: [], tag }) as unknown as PilotModel;
const question = (n: number) => ({ done: false, settled: [], threadId: null, kind: "free-text", prompt: `Question ${n}` }) as unknown as Snapshot["question"];

/** An interview of `answers` answers past a three-answer opening, with Back's history as the interview builds it. */
function interview(answers: number) {
  const exchanges = ex(3 + answers);
  const choices = [{ preferred: "2001", other: "2002", strength: "slightly" as const }];
  const tripChoices = [{ preferred: "a", other: "b", strength: "strongly" as const }];
  const pastTrades = ["days-off|pay"];
  const m1 = model("first");
  const m2 = model("second");
  const history: Snapshot[] = Array.from({ length: answers }, (_, i) => ({
    exchanges: exchanges.slice(0, 3 + i),
    choices: choices.slice(0, i >= 1 ? 1 : 0),
    tripChoices: tripChoices.slice(0, i >= 2 ? 1 : 0),
    pastTrades: pastTrades.slice(0, i >= 1 ? 1 : 0),
    question: question(i),
    turn: i,
    threads: { [`t-${i}`]: { status: "open", timesAsked: 1 } },
    model: i < 2 ? m1 : m2,
    builtUpTo: i < 2 ? 3 : 5,
  }));
  return { exchanges, choices, tripChoices, pastTrades, history };
}

describe("Back after a reload", () => {
  it("comes back as it was, from the draft's own lists", () => {
    const it4 = interview(4);
    const saved = JSON.parse(JSON.stringify(saveBack(it4.history)));
    const back = restoreBack(saved.back, saved.backModels, it4);
    expect(back).toEqual(it4.history);
  });

  it("keeps each model once, not once per answer", () => {
    const { back, backModels } = saveBack(interview(4).history);
    expect(backModels).toHaveLength(2);
    expect(back.map((b) => b.model)).toEqual([0, 0, 1, 1]);
    // No copies of the answers: only how many there were.
    expect(JSON.stringify(back)).not.toContain("A0");
  });

  it("brings back none of it when a step doesn't fit the draft's answers", () => {
    const it4 = interview(4);
    const { back, backModels } = saveBack(it4.history);
    // Fewer answers than the steps say: a draft from somewhere else.
    expect(restoreBack(back, backModels, { ...it4, exchanges: it4.exchanges.slice(0, 5) })).toEqual([]);
    // A model it doesn't have.
    expect(restoreBack(back.map((b) => ({ ...b, model: 7 })), backModels, it4)).toEqual([]);
    // Out of order.
    expect(restoreBack([back[1], back[0]], backModels, it4)).toEqual([]);
    expect(restoreBack(undefined, undefined, it4)).toEqual([]);
    expect(restoreBack("junk", null, it4)).toEqual([]);
  });

  it("is empty for a draft with no answers given yet", () => {
    expect(saveBack([])).toEqual({ back: [], backModels: [] });
    expect(restoreBack([], [], interview(0))).toEqual([]);
  });
});

describe("an answer too long for the brain routes", () => {
  it("is cut to the limit, and every other answer left as it is", () => {
    const exchanges = [...ex(2), { turn: 2, question: "Q2", answer: "x".repeat(MAX_ANSWER + 500) }];
    const fitted = fitExchanges(exchanges);
    expect(fitted[2].answer).toHaveLength(MAX_ANSWER);
    expect(fitted.slice(0, 2)).toEqual(exchanges.slice(0, 2));
    // Nothing too long: the same list back.
    expect(fitExchanges(ex(3))).toEqual(ex(3));
  });
});
