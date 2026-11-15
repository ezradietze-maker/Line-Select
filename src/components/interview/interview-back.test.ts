import { describe, expect, it } from "vitest";
import { beforeSweepAnswer, draftBack, laterBack, wrapUpFrom } from "@/components/interview/BrainInterview";
import { SWEEP_QUESTION } from "@/lib/brain/interview-pace";

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

describe("Back after a reload", () => {
  const Q = { prompt: "Line 2001 vs Line 2002?" };
  const read = { id: "before" };
  const fitted = { id: "fitted" };
  /** The draft saved on a screen, as a resume reads it back, and where Back then goes from `phase`. */
  const resumed = (over: Partial<Parameters<typeof draftBack>[0]>) => {
    const saved = JSON.parse(JSON.stringify(draftBack({ phase: "question", atReview: false, question: Q, sweepFrom: "answered", finishFrom: "answered", model: read, beforeFinish: null, ...over })));
    const back = (phase: "sweep" | "review") => laterBack(at({ phase, hasQuestion: !!saved.question, sweepFrom: saved.sweepFrom ?? "answered", finishFrom: saved.finishFrom ?? "answered" }));
    return { ...saved, back };
  };

  it("goes back to the question \"That's enough\" was tapped on, not the answer before it", () => {
    expect(resumed({ phase: "sweep", sweepFrom: "question" }).back("sweep")).toBe("question");
    expect(resumed({ phase: "review", atReview: true, finishFrom: "question" }).back("review")).toBe("question");
    expect(resumed({ phase: "review", atReview: true, finishFrom: "sweep" }).back("review")).toBe("sweep");
    // And from the "anything else?" screen Back goes to next, after "That's enough" on it.
    expect(resumed({ phase: "review", atReview: true, finishFrom: "sweep", sweepFrom: "question" }).question).toEqual(Q);
  });

  it("never keeps a question already answered, which a resume would show again", () => {
    expect(resumed({ phase: "sweep", sweepFrom: "answered" }).question).toBeNull();
    expect(resumed({ phase: "asking" }).question).toBeNull();
    expect(resumed({ phase: "review", atReview: true, finishFrom: "answered" }).question).toBeNull();
    expect(resumed({ phase: "review", atReview: true, finishFrom: "sweep", sweepFrom: "answered" }).question).toBeNull();
  });

  it("keeps, on the priorities, the read they were built on: built on the fitted one, the next read fitted the choices in twice", () => {
    expect(resumed({ phase: "review", atReview: true, model: fitted, beforeFinish: read }).model).toEqual(read);
    expect(resumed({ phase: "question", model: read, beforeFinish: fitted }).model).toEqual(read);
  });
});

describe("Back after \"anything else?\" when the interviewer wraps up with no follow-up", () => {
  const asked = [
    { turn: 4, question: "Line 2001 vs Line 2002?", answer: "2001" },
    { turn: 5, question: SWEEP_QUESTION, answer: "These matter to me too: Weekends off." },
  ];

  it("goes back to the \"anything else?\" screen, not past it to the question before", () => {
    // Taken for an answer, Back took the last step back: the question before "anything else?", two screens back.
    expect(laterBack(at({ phase: "review", finishFrom: wrapUpFrom(asked) }))).toBe("sweep");
    expect(laterBack(at({ phase: "building", error: true, finishFrom: wrapUpFrom(asked) }))).toBe("sweep");
    // Wrapped up after any other answer, Back still takes that answer back.
    expect(wrapUpFrom(asked.slice(0, 1))).toBe("answered");
  });

  it("takes the answer given there back with it, so it isn't sent twice", () => {
    expect(beforeSweepAnswer(asked, 6)).toEqual({ exchanges: asked.slice(0, 1), turn: 5 });
    // Nothing picked there, nothing to take back.
    expect(beforeSweepAnswer(asked.slice(0, 1), 5)).toBeNull();
  });
});
