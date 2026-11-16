import { describe, expect, it } from "vitest";
import { readCaptions } from "@/lib/tutorial-captions";

describe("the tutorial's captions choice", () => {
  it("is on until the pilot turns it off", () => {
    expect(readCaptions(null)).toBe(true);
    expect(readCaptions("something else")).toBe(true);
  });

  it("is what the pilot chose, for every chapter", () => {
    expect(readCaptions("off")).toBe(false);
    expect(readCaptions("on")).toBe(true);
  });
});
