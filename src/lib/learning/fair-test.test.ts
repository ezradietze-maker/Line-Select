import { describe, expect, it } from "vitest";
import { MIN_AWARDS, testCalibration, type CalibrationCase } from "./fair-test";

const ranking = Array.from({ length: 10 }, (_, i) => i);
/** A pilot awarded their `at`-th choice: every line above it was gone. */
const award = (at: number, pAvailable: (i: number) => number): CalibrationCase => ({
  prediction: { ranking, pAvailable: ranking.map(pAvailable) },
  award: { outcome: "line", lineIndex: at },
});
const now = new Date(0);

describe("the fair test for a new forecast calibration", () => {
  it("waits for enough different awards — not pairs", () => {
    const cases = Array.from({ length: MIN_AWARDS - 1 }, (_, i) => award(5 + (i % 4), () => 0.9));
    expect(testCalibration(cases, "fc", now)).toMatchObject({ ready: false, reason: `${MIN_AWARDS - 1} checked awards so far — needs ${MIN_AWARDS}` });
  });

  it("puts a calibration to use when it clearly beats the raw forecast on awards it never saw", () => {
    // The raw forecast says every line is 90% likely to be open; most were already gone.
    const cases = Array.from({ length: 40 }, (_, i) => award(4 + (i % 5), () => 0.9));
    const t = testCalibration(cases, "fc", now);
    expect(t).toMatchObject({ ready: true, promote: true });
    if (t.ready) expect(t.brierChallenger).toBeLessThan(t.brierUncalibrated);
  });

  it("keeps the raw forecast when there's nothing to gain", () => {
    // Already as right as it can be: every checked line was open exactly half the time, and the forecast says 50%.
    const cases = Array.from({ length: 40 }, () => award(1, () => 0.5));
    expect(testCalibration(cases, "fc", now)).toMatchObject({ ready: true, promote: false });
  });

  it("gives the same verdict for the same data", () => {
    const cases = Array.from({ length: 36 }, (_, i) => award(2 + (i % 7), (line) => 0.4 + line * 0.05));
    expect(testCalibration(cases, "fc", now)).toEqual(testCalibration(cases, "fc", now));
  });
});
