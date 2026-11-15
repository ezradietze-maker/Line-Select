import { describe, expect, it } from "vitest";
import { fitFont, stripLayout } from "@/components/results/BidPackStrip";

describe("the bid pack view's day columns", () => {
  it("sizes the words so a four-figure flight number fits its day", () => {
    for (const col of [19, 20, 22, 23, 26, 30]) {
      const font = fitFont(col);
      expect(4 * 0.6 * font, `col ${col}`).toBeLessThanOrEqual(col - 2);
      expect(font).toBeGreaterThanOrEqual(7);
      expect(font).toBeLessThanOrEqual(9);
    }
  });

  it("keeps the full 9px size where the days have room", () => {
    expect(fitFont(30)).toBe(9);
    // A laptop with the sidebar open, five weeks across: about 22px a day, which used to be drawn at 8px and touch.
    const laptop = stripLayout(1010, 35);
    expect(laptop.mode).toBe("fit");
    expect(4 * 0.6 * laptop.font).toBeLessThanOrEqual(laptop.daysPx / 35 - 2);
  });
});
