import { describe, expect, it } from "vitest";
import { computeInterviewProgress } from "@/lib/interview-progress";
import { EXPLICIT_WEIGHT_IDS, MIN_TURNS_BEFORE_WRAP } from "@/lib/interview-engine";

const TOTAL = EXPLICIT_WEIGHT_IDS.length;

describe("computeInterviewProgress", () => {
  it("at the start, expects at least the minimum number of questions and never claims 35", () => {
    const p = computeInterviewProgress({ turnsUsed: 0, uncoveredCount: TOTAL, preStepsDone: 2, preStepTotal: 2 });
    expect(p.questionsLeft).toBe(MIN_TURNS_BEFORE_WRAP);
    expect(p.topicsCovered).toBe(0);
    expect(p.fraction).toBeGreaterThan(0);
    expect(p.fraction).toBeLessThan(0.2);
  });

  it("counts down minimum-turn questions while all topics are covered", () => {
    const p = computeInterviewProgress({ turnsUsed: 15, uncoveredCount: 0, preStepsDone: 2, preStepTotal: 2 });
    expect(p.questionsLeft).toBe(MIN_TURNS_BEFORE_WRAP - 15);
    expect(p.topicsCovered).toBe(TOTAL);
  });

  it("uses uncovered topics as the floor once past the minimum turns", () => {
    const p = computeInterviewProgress({ turnsUsed: 25, uncoveredCount: 4, preStepsDone: 2, preStepTotal: 2 });
    expect(p.questionsLeft).toBe(4);
  });

  it("always reports at least one question and one minute left, and never reaches 100%", () => {
    const p = computeInterviewProgress({ turnsUsed: 40, uncoveredCount: 0, preStepsDone: 2, preStepTotal: 2 });
    expect(p.questionsLeft).toBe(1);
    expect(p.minutesLeft).toBe(1);
    expect(p.fraction).toBeLessThan(1);
  });

  it("moves forward as questions are answered", () => {
    const a = computeInterviewProgress({ turnsUsed: 5, uncoveredCount: 10, preStepsDone: 2, preStepTotal: 2 });
    const b = computeInterviewProgress({ turnsUsed: 6, uncoveredCount: 9, preStepsDone: 2, preStepTotal: 2 });
    expect(b.fraction).toBeGreaterThan(a.fraction);
  });
});
