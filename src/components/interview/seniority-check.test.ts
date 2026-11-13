import { describe, expect, it } from "vitest";
import { checkSeniority, parseSeniorityInput } from "@/components/interview/SeniorityStep";

const list = [
  { seniority: 120, bidNumber: 1 },
  { seniority: 340, bidNumber: 2 },
  { seniority: 901, bidNumber: 3 },
];

describe("a seniority number as typed, in the interview and the quick start", () => {
  it("finds a number on the pack's list", () => {
    expect(checkSeniority("340", list)).toEqual({ kind: "found", bidNumber: 2 });
  });

  it("warns for a number not on the list, with where it would fall", () => {
    expect(checkSeniority("999999", list)).toEqual({ kind: "not-listed", bidNumber: 4 });
    expect(checkSeniority("200", list)).toEqual({ kind: "not-listed", bidNumber: 2 });
  });

  it("says why a 0 won't do, rather than dropping it without a word", () => {
    expect(parseSeniorityInput("0")).toBeNull();
    expect(checkSeniority("0", list)).toEqual({ kind: "not-a-number" });
    expect(checkSeniority("000", [])).toEqual({ kind: "not-a-number" });
  });

  it("says nothing for an empty box, or with no list to check against", () => {
    expect(checkSeniority("", list)).toBeNull();
    expect(checkSeniority("  ", list)).toBeNull();
    expect(checkSeniority("1234", [])).toBeNull();
  });
});
