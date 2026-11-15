import { describe, expect, it } from "vitest";
import { placeMenu } from "@/components/results/LineContextMenu";

describe("placeMenu", () => {
  it("opens at the pointer when it fits", () => {
    expect(placeMenu({ x: 100, y: 120 }, { width: 208, height: 300 }, { width: 1280, height: 800 })).toEqual({ x: 100, y: 120 });
  });
  it("moves left and up to stay on screen", () => {
    expect(placeMenu({ x: 1200, y: 700 }, { width: 208, height: 300 }, { width: 1280, height: 800 })).toEqual({ x: 1064, y: 492 });
  });
  it("never puts its top above the screen when it's taller than the space", () => {
    // A 320-tall phone turned sideways, the menu with five tiers about 400 tall: moved up by its height, its top sat at
    // -88 and Select all above and below were out of reach.
    expect(placeMenu({ x: 100, y: 200 }, { width: 208, height: 400 }, { width: 568, height: 320 })).toEqual({ x: 100, y: 8 });
    expect(placeMenu({ x: 300, y: 10 }, { width: 208, height: 100 }, { width: 200, height: 320 }).x).toBe(8);
  });
});
