import { describe, expect, it } from "vitest";
import { buildTarget, setTargetRole, targetParts } from "@/lib/target-editing";

describe("targetParts / buildTarget", () => {
  it("round-trips a bare number as a bare number", () => {
    expect(buildTarget(targetParts(14))).toBe(14);
  });

  it("round-trips a full range", () => {
    expect(buildTarget(targetParts({ min: 12, ideal: 14, max: 16 }))).toEqual({ min: 12, ideal: 14, max: 16 });
  });

  it("treats no parts as no target", () => {
    expect(buildTarget({})).toBeUndefined();
    expect(targetParts(undefined)).toEqual({});
  });

  it("keeps a floor-only or ceiling-only band as a range, not a bare number", () => {
    expect(buildTarget({ min: 12 })).toEqual({ min: 12 });
    expect(buildTarget({ max: 16, ideal: 14 })).toEqual({ ideal: 14, max: 16 });
  });
});

describe("setTargetRole", () => {
  it("drags the ideal and ceiling up when the floor is raised past them", () => {
    expect(setTargetRole({ min: 12, ideal: 14, max: 16 }, "min", 17)).toEqual({ min: 17, ideal: 17, max: 17 });
  });

  it("drags the ideal and floor down when the ceiling is lowered past them", () => {
    expect(setTargetRole({ min: 12, ideal: 14, max: 16 }, "max", 10)).toEqual({ min: 10, ideal: 10, max: 10 });
  });

  it("keeps the floor and ceiling in order around a moved ideal", () => {
    expect(setTargetRole({ min: 12, ideal: 14, max: 16 }, "ideal", 11)).toEqual({ min: 11, ideal: 11, max: 16 });
    expect(setTargetRole({ min: 12, ideal: 14, max: 16 }, "ideal", 18)).toEqual({ min: 12, ideal: 18, max: 18 });
  });

  it("leaves untouched roles undefined", () => {
    expect(setTargetRole({}, "ideal", 14)).toEqual({ ideal: 14 });
  });
});
