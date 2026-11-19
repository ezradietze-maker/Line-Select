import { describe, expect, it } from "vitest";
import { creditFits, fitFont, stripLayout } from "@/components/results/BidPackStrip";
import { textScaleOf } from "@/lib/use-text-scale";

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

describe("a trip's number and credit in the bid pack view", () => {
  it("leaves the credit off where its days can't hold it, rather than cut it short", () => {
    // A300 MEM CAP line 1036 on a phone: two-day trip 134 with 136 the day after, 44px for "134 10:14" (49.9px), which
    // read "134 10:1".
    expect(creditFits("134", 10 + 14 / 60, 2, 24, 9)).toBe(false);
    // A shorter credit fits the same two days, and a day trip with free days after it has room for its credit.
    expect(creditFits("63", 9 + 44 / 60, 2, 24, 9)).toBe(true);
    expect(creditFits("137", 7 + 9 / 60, 5, 24, 9)).toBe(true);
    // B777 ANC FO line 2045's trip 27, "27 16:29" in two days on a phone: drawn whole, and kept.
    expect(creditFits("27", 16 + 29 / 60, 2, 24, 9)).toBe(true);
    // B767 MEM CAP line 1290: day trip 267 on a Saturday, its day a pixel narrower for the weekend's line, read "6:2".
    expect(creditFits("267", 6 + 24 / 60, 2, 23, 9)).toBe(false);
  });
});

describe("the strips at bigger text", () => {
  it("lays out as before at the usual text size", () => {
    expect(stripLayout(1010, 35, 1)).toEqual(stripLayout(1010, 35));
    expect(stripLayout(1010, 35).textScale).toBe(1);
  });

  it("stacks a laptop's list at 200% text, as the page around it does", () => {
    // A 1280px window at 200% text: the numbers beside the days need 448px, and in 224 their words ran over each other.
    expect(stripLayout(1216, 35, 2).stacked).toBe(true);
    expect(stripLayout(1216, 35, 1).stacked).toBe(false);
  });

  it("gives the numbers twice the room on a wide screen at 200% text, and the days what's left", () => {
    const wide = stripLayout(1850, 35, 2);
    expect(wide.mode).toBe("fit");
    expect(wide.textScale).toBe(2);
    expect(wide.daysPx).toBe(1850 - 2 - (24 + 240 + 22 + 16) * 2);
  });
});

describe("the browser's text size", () => {
  it("reads the root's px as a scale, never below 1", () => {
    expect(textScaleOf(32)).toBe(2);
    expect(textScaleOf(20)).toBe(1.25);
    expect(textScaleOf(16)).toBe(1);
    expect(textScaleOf(12)).toBe(1);
    expect(textScaleOf(NaN)).toBe(1);
  });
});
