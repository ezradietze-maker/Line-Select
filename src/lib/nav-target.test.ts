import { describe, expect, it } from "vitest";
import { navTargetForPath } from "@/lib/nav-target";

describe("navTargetForPath", () => {
  it("highlights Preferences on the Preferences page itself, not just its interview sub-steps", () => {
    expect(navTargetForPath("/preferences")).toBe("preferences");
    expect(navTargetForPath("/interview")).toBe("preferences");
    expect(navTargetForPath("/confirm-preferences")).toBe("preferences");
  });

  it("keeps the upload flow under Upload Bid Pack", () => {
    expect(navTargetForPath("/upload")).toBe("upload");
    expect(navTargetForPath("/preview")).toBe("upload");
  });

  it("maps every other sidebar destination to itself", () => {
    expect(navTargetForPath("/results")).toBe("results");
    expect(navTargetForPath("/strategies")).toBe("strategies");
    expect(navTargetForPath("/trade-board")).toBe("trade-board");
    expect(navTargetForPath("/inbox")).toBe("inbox");
    expect(navTargetForPath("/hotel-ratings")).toBe("hotel-ratings");
  });

  it("lights nothing on info pages that aren't sidebar destinations", () => {
    expect(navTargetForPath("/how-it-works")).toBeNull();
    expect(navTargetForPath("/pricing")).toBeNull();
    expect(navTargetForPath("/privacy")).toBeNull();
    expect(navTargetForPath("/terms")).toBeNull();
  });
});
