import { describe, expect, it } from "vitest";
import { describeAnswer, questionTopicLabel, storyTopicsMentioned } from "@/lib/interview-display";
import type { InterviewQuestion } from "@/types/interview-session";

const slider: InterviewQuestion = {
  id: "q1",
  kind: "slider",
  prompt: "Days off vs a fuller month?",
  boundTo: "daysOff",
  lowLabel: "Fine with a compact month",
  centerLabel: "No strong lean",
  highLabel: "As many days off as I can get",
};

describe("questionTopicLabel", () => {
  it("names the topic a bound question is about", () => {
    expect(questionTopicLabel(slider)).toBe("Days off");
    expect(
      questionTopicLabel({ id: "q", kind: "target-slider", prompt: "", boundTo: "circadianTolerance", unitSingular: "show", unitPlural: "shows" })
    ).toBe("Early shows in a row");
  });

  it("has nothing to say for an unbound question", () => {
    expect(questionTopicLabel({ id: "q", kind: "free-text", prompt: "Why?" })).toBeNull();
  });
});

describe("describeAnswer", () => {
  it("says which side a slider leaned toward, and how hard", () => {
    expect(describeAnswer(slider, { kind: "slider", value: 60 })).toBe("Strongly: As many days off as I can get.");
    expect(describeAnswer(slider, { kind: "slider", value: -20 })).toBe("Leaning: Fine with a compact month.");
    expect(describeAnswer(slider, { kind: "slider", value: 5 })).toBe("No strong lean.");
  });

  it("reads back a number with its unit and range role", () => {
    const q: InterviewQuestion = { id: "q", kind: "target-slider", prompt: "", boundTo: "daysOff", unitSingular: "day off", unitPlural: "days off", rangeRole: "min" };
    expect(describeAnswer(q, { kind: "target-slider", value: 15 })).toBe("At least 15 days off.");
    expect(describeAnswer(q, { kind: "target-slider", value: undefined })).toBe("No exact number for this one.");
  });

  it("reads back the chosen option and free text as given", () => {
    const q: InterviewQuestion = { id: "q", kind: "choice", prompt: "", options: [{ label: "Front end" }, { label: "Back end" }] };
    expect(describeAnswer(q, { kind: "choice", selectedIndex: 1 })).toBe("Back end");
    expect(describeAnswer({ id: "q", kind: "free-text", prompt: "" }, { kind: "free-text", text: "Loud hotel." })).toBe("Loud hotel.");
    expect(describeAnswer(q, { kind: "skipped" })).toBe("Skipped this one.");
  });
});

describe("storyTopicsMentioned", () => {
  it("lights the topics a story touches", () => {
    const t = storyTopicsMentioned("I look for days off first, coach my daughter's softball Saturdays, and avoid the Bogota hotel.");
    expect(t.has("days-off")).toBe(true);
    expect(t.has("life")).toBe(true);
    expect(t.has("layovers")).toBe(true);
    expect(t.has("pay")).toBe(false);
  });

  it("finds nothing in an empty story", () => {
    expect(storyTopicsMentioned("").size).toBe(0);
  });
});
