import { describe, expect, it } from "vitest";
import { COMMUTE_TIME_QUESTION, nextCommuteQuestion, OTHER_FLIGHTS_QUESTION } from "./commute-questions";

describe("the commute questions", () => {
  it("asks a commuter how much time they leave, then how many other flights they want, one at a time", () => {
    expect(nextCommuteQuestion(true, [])?.prompt).toBe(COMMUTE_TIME_QUESTION);
    expect(nextCommuteQuestion(true, [{ question: COMMUTE_TIME_QUESTION }])?.prompt).toBe(OTHER_FLIGHTS_QUESTION);
    expect(nextCommuteQuestion(true, [{ question: COMMUTE_TIME_QUESTION }, { question: OTHER_FLIGHTS_QUESTION }])).toBeNull();
  });

  it("doesn't ask a pilot who lives in the domicile city", () => {
    expect(nextCommuteQuestion(false, [])).toBeNull();
    expect(nextCommuteQuestion(null, [])).toBeNull();
  });

  it("asks one thing each", () => {
    for (const q of [COMMUTE_TIME_QUESTION, OTHER_FLIGHTS_QUESTION]) expect(q.match(/\?/g)).toHaveLength(1);
  });
});
