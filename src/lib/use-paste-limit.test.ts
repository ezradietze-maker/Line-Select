import { describe, expect, it } from "vitest";
import { pasteRunsOver } from "./use-paste-limit";

describe("a paste into a box with a limit", () => {
  it("runs over when what's kept and what's pasted pass the limit", () => {
    // A story written elsewhere, pasted whole into the 12,000-character story box: the end went without a word.
    expect(pasteRunsOver("", 0, "x".repeat(15_000), 12_000)).toBe(true);
    expect(pasteRunsOver("a".repeat(11_990), 0, "x".repeat(20), 12_000)).toBe(true);
  });

  it("doesn't when it fits, counting what the paste replaces", () => {
    expect(pasteRunsOver("", 0, "x".repeat(12_000), 12_000)).toBe(false);
    expect(pasteRunsOver("a".repeat(11_990), 100, "x".repeat(100), 12_000)).toBe(false);
  });

  it("counts a copied line break as the one character the box keeps", () => {
    expect(pasteRunsOver("", 0, "ab\r\n".repeat(3_000), 9_000)).toBe(false);
  });

  it("never runs over in a box with no limit", () => {
    expect(pasteRunsOver("", 0, "x".repeat(50_000), undefined)).toBe(false);
  });
});
