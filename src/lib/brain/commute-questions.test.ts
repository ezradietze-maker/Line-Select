import { describe, expect, it } from "vitest";
import { COMMUTE_TIME_QUESTION, nextCommuteQuestion } from "./commute-questions";

describe("the commute questions", () => {
  it("asks a commuter once how much time they leave — and not how many other flights they want (the owner: unnecessary)", () => {
    expect(nextCommuteQuestion(true, [])?.prompt).toBe(COMMUTE_TIME_QUESTION);
    expect(nextCommuteQuestion(true, [{ question: COMMUTE_TIME_QUESTION }])).toBeNull();
  });

  it("doesn't ask a pilot who lives in the domicile city", () => {
    expect(nextCommuteQuestion(false, [])).toBeNull();
    expect(nextCommuteQuestion(null, [])).toBeNull();
  });

  it("asks one thing", () => {
    expect(COMMUTE_TIME_QUESTION.match(/\?/g)).toHaveLength(1);
  });
});
