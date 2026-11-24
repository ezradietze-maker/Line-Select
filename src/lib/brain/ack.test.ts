import { describe, expect, it } from "vitest";
import { ackFitsLast, answerAck } from "./ack";

describe("answerAck", () => {
  it("names the pick after a line or trip choice", () => {
    expect(answerAck({ question: "Which? [Line 1210 vs Line 1982: …]", answer: "I'd bid line 1210 over line 1982 (just)." })).toBe("Line 1210 over 1982. Got it.");
    expect(answerAck({ question: "Which? [Trip #306 · Oct 5 {306@4} vs Trip #459 · Oct 9 {459@8}: …]", answer: "I'd rather fly Trip #459 · Oct 9 than Trip #306 · Oct 5 (easily). Why: home sooner" })).toBe("#459 over #306, easily. Got it.");
    expect(answerAck({ question: "Which?", answer: "Couldn't choose between Trip #306 · Oct 5 and Trip #459 · Oct 9 — about the same to me." })).toBe("#306 and #459 about even. Got it.");
  });

  it("counts a screen of grades, and says a short answer back whole", () => {
    expect(answerAck({ question: "Trip grades: how would you feel… [Trip #1 · Oct 1 {1@0}; Trip #2 · Oct 2 {2@1}]", answer: "Trip #1 · Oct 1: love; Trip #2 · Oct 2: poor." })).toBe("2 trips graded, got it.");
    expect(answerAck({ question: "How long before a report?", answer: "Three hours." })).toBe("Three hours. Got it.");
    expect(answerAck({ question: "Anything that rules a line out?", answer: "Anything with more than two commutes in the month and a lot of night flying on top of that." })).toBe("Got it.");
    expect(answerAck({ question: "Q", answer: "(skipped)" })).toBe("Skipping that one is fine.");
    expect(answerAck(undefined)).toBe("");
  });

  it("says their 'I' and 'me' back as 'you', and never says a question of theirs back", () => {
    expect(answerAck({ question: "Hub turn nap?", answer: "I'd take the nap" })).toBe("You'd take the nap. Got it.");
    expect(answerAck({ question: "Night hub turns?", answer: "They don't bother me" })).toBe("They don't bother you. Got it.");
    expect(answerAck({ question: "Q", answer: "I was fine with my old line." })).toBe("You were fine with your old line. Got it.");
    expect(answerAck({ question: "Q", answer: "no preference" })).toBe("No preference. Got it.");
    expect(answerAck({ question: "Q", answer: "What's a hub turn?" })).toBe("Got it.");
  });
});

describe("ackFitsLast", () => {
  const pick = { question: "Which? [Line 1210 vs Line 1982: …]", answer: "I'd bid line 1210 over line 1982 (just)." };
  it("wants a pick's line named, and lets any other answer's line stand", () => {
    expect(ackFitsLast("Paris over everything — got it.", pick)).toBe(false);
    expect(ackFitsLast("1210 for the days off — got it.", pick)).toBe(true);
    expect(ackFitsLast("Saturdays over Sundays — got it.", { question: "Which day?", answer: "Saturdays." })).toBe(true);
  });
});
