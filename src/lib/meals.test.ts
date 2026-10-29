import { describe, expect, it } from "vitest";
import { mealWords } from "./meals";

describe("mealWords", () => {
  it("says each code the ex-pilot explained", () => {
    expect(["S", "DS", "BS", "DH", "BH"].map(mealWords)).toEqual(["Snack", "Dinner snack", "Breakfast snack", "Dinner hot", "Breakfast hot"]);
  });

  it("reads two meals in order, and leaves the trailing I aside", () => {
    expect(mealWords("DH/BH")).toBe("Dinner hot, then breakfast hot");
    expect(mealWords("BSI")).toBe("Breakfast snack");
  });

  it("prints a code nobody has explained as itself", () => {
    expect(mealWords("NOCAT")).toBe("NOCAT");
    expect(mealWords("BM/DS")).toBe("BM, then dinner snack");
  });
});
