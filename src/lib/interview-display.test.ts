import { describe, expect, it } from "vitest";
import { describeAnswer, questionTopicLabel, storyDepth, storyTopicsMentioned } from "@/lib/interview-display";
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

  it("tells apart areas a single broad topic used to lump together", () => {
    const t = storyTopicsMentioned("I avoid three-leg duty periods, want at least two backup flights on a front-end deadhead, and like hotel standby.");
    expect(t.has("legs")).toBe(true);
    expect(t.has("deadheads")).toBe(true);
    expect(t.has("reserve")).toBe(true);
    expect(t.has("trips")).toBe(false);
  });
});

describe("storyDepth", () => {
  const sentence = "I look for days off first, then pay, and I avoid early reports and long trips. ";

  it("is empty for an empty story", () => {
    expect(storyDepth("").level).toBe(0);
  });

  it("doesn't call a short paragraph plenty", () => {
    const d = storyDepth(sentence.repeat(7));
    expect(d.words).toBeGreaterThan(100);
    expect(d.level).toBeLessThanOrEqual(2);
  });

  it("needs breadth as well as length", () => {
    // 900 words that only ever touch a few areas.
    expect(storyDepth(sentence.repeat(55)).level).toBeLessThan(5);
  });

  it("calls a long story across most areas plenty", () => {
    const wide =
      "What matters most is quality of life. Days off come first, ideally a block of days in a row and my weekends. I like short trips, single legs per duty period, and no early reports. " +
      "Sleep and the body clock matter; red-eyes wreck me. Favorite cities are Paris and Seoul, and I like long layovers at a good hotel. Pay per day away matters too. " +
      "I commute from Denver, and a deadhead I can deviate on with backup flights is gold. Hotel standby is fine. I prefer Pacific flying over domestic. My kids' soccer is Saturdays. ";
    expect(storyDepth(wide.repeat(5)).level).toBe(5);
  });
});
