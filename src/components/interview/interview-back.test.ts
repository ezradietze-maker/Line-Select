import { describe, expect, it } from "vitest";
import { laterBack } from "@/components/interview/BrainInterview";

const at = (over: Partial<Parameters<typeof laterBack>[0]>): Parameters<typeof laterBack>[0] => ({
  phase: "question",
  history: 3,
  hasQuestion: true,
  error: false,
  confirming: false,
  sweepFrom: "answered",
  finishFrom: "answered",
  ...over,
});

describe("Back once the questions have started", () => {
  it("takes the last answer back on a question, and has nowhere to go before the first", () => {
    expect(laterBack(at({}))).toBe("answer");
    expect(laterBack(at({ history: 0 }))).toBeNull();
  });

  it("has a Back on the \"anything else?\" screen: to the question \"That's enough\" was tapped on, or the answer before it", () => {
    expect(laterBack(at({ phase: "sweep", sweepFrom: "question" }))).toBe("question");
    expect(laterBack(at({ phase: "sweep", sweepFrom: "answered" }))).toBe("answer");
    // Resumed there, with no question kept: the last answer, if there is one.
    expect(laterBack(at({ phase: "sweep", sweepFrom: "question", hasQuestion: false }))).toBe("answer");
    expect(laterBack(at({ phase: "sweep", history: 0 }))).toBeNull();
  });

  it("has a Back on the priorities screen, to where they were built from, but not while they're being saved", () => {
    expect(laterBack(at({ phase: "review", finishFrom: "sweep" }))).toBe("sweep");
    expect(laterBack(at({ phase: "review", finishFrom: "question" }))).toBe("question");
    expect(laterBack(at({ phase: "review", finishFrom: "answered" }))).toBe("answer");
    expect(laterBack(at({ phase: "review", confirming: true }))).toBeNull();
    expect(laterBack(at({ phase: "review", history: 0 }))).toBeNull();
  });

  it("keeps the Back off a last read that failed, and none while one is under way", () => {
    expect(laterBack(at({ phase: "building", error: true, finishFrom: "sweep" }))).toBe("sweep");
    expect(laterBack(at({ phase: "building", error: true, finishFrom: "question", history: 0 }))).toBe("question");
    expect(laterBack(at({ phase: "building" }))).toBeNull();
    expect(laterBack(at({ phase: "asking" }))).toBeNull();
  });
});
