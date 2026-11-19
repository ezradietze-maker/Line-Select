import { describe, expect, it } from "vitest";
import { formatIndex, satisfactionScale, withSatisfactionIndex } from "@/lib/satisfaction-index";

// The ex-pilot's own MD-11 pack as his model scored it (Nov 2026): best 67.9, the tenth from the bottom 29.2, the last 14.8.
const fits = [67.9, 60.2, 57.6, 56.5, 56.2, 54.6, 51.9, 51.9, 49, 47.3, 45.8, 45.8, 44.4, 44.4, 43, 41, 39.5, 37, 35, 33, 31.5, 30, 29.2, 25, 20, 14.8];

describe("the Satisfaction Index", () => {
  it("puts the pack's best line in the high 90s, higher the better it really fits", () => {
    expect(satisfactionScale(fits)(67.9)).toBeGreaterThanOrEqual(96);
    expect(satisfactionScale(fits)(67.9)).toBeLessThan(98);
    expect(satisfactionScale([95, 60, 40])(95)).toBe(99);
    expect(satisfactionScale([45, 30, 20])(45)).toBe(96);
  });

  it("spreads the lines over most of the scale instead of a band of 30", () => {
    const scale = satisfactionScale(fits);
    const shown = fits.map(scale);
    expect(Math.max(...shown) - Math.min(...shown)).toBeGreaterThan(70);
    // The line a tenth of the way up from the bottom reads about 20.
    const low = [...fits].sort((a, b) => a - b)[Math.floor(0.1 * (fits.length - 1))];
    expect(scale(low)).toBeCloseTo(20, 0);
  });

  it("keeps the order and never ties lines the fit score sets apart", () => {
    const scale = satisfactionScale(fits);
    const shown = fits.map(scale);
    for (let i = 1; i < fits.length; i++) {
      if (fits[i] < fits[i - 1]) expect(shown[i]).toBeLessThan(shown[i - 1]);
      else expect(shown[i]).toBe(shown[i - 1]);
    }
  });

  it("keeps the last lines apart and above 1, and never stretches a pack more than three times", () => {
    const scale = satisfactionScale(fits);
    expect(scale(14.8)).toBeGreaterThan(1);
    expect(scale(14.8)).toBeLessThan(scale(20));
    // Lines a hair apart in a tight pack stay close: 2 points of fit is at most 6 of index.
    const tight = satisfactionScale([70, 69, 68, 68, 67]);
    expect(tight(70) - tight(68)).toBeLessThanOrEqual(6);
  });

  it("copes with one line, or none", () => {
    expect(satisfactionScale([50])(50)).toBe(96);
    expect(satisfactionScale([])(42)).toBe(42);
  });

  it("swaps the score on a ranked list and keeps the fit score beside it", () => {
    const shown = withSatisfactionIndex([{ id: "a", score: 67.9 }, { id: "b", score: 29.2 }]);
    expect(shown[0]).toMatchObject({ id: "a", fitScore: 67.9 });
    expect(shown[0].score).toBeGreaterThan(95);
    expect(shown[1].fitScore).toBe(29.2);
  });

  it("is said to one decimal", () => {
    expect(formatIndex(97)).toBe("97.0");
    expect(formatIndex(64.96)).toBe("65.0");
    expect(formatIndex(20.04)).toBe("20.0");
  });
});
