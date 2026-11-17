import { describe, expect, it } from "vitest";
import { NAV_ITEMS, disabledReason, navItemName } from "@/components/nav/nav-items";

describe("which destinations the nav greys out", () => {
  it("greys out what a guest with nothing loaded can't open yet", () => {
    expect(disabledReason("results", false, false)).toMatch(/preferences first/);
    expect(disabledReason("strategies", true, false)).toMatch(/bid pack first/);
    expect(disabledReason("results", true, true)).toBeUndefined();
  });

  it("greys out nothing before the pilot's saved state has loaded: a signed-in pilot isn't shown a guest's nav", () => {
    expect(disabledReason("results", false, false, false)).toBeUndefined();
    expect(disabledReason("strategies", false, false, false)).toBeUndefined();
  });
});

describe("what the nav marks as coming soon", () => {
  it("tags View/Add and Open Time, which aren't finished, and nothing else", () => {
    expect(NAV_ITEMS.filter((i) => i.comingSoon).map((i) => i.target)).toEqual(["view-add", "open-time"]);
  });

  it("says so in the item's full name, for tooltips and screen readers", () => {
    expect(navItemName(NAV_ITEMS.find((i) => i.target === "open-time")!)).toBe("Open Time (coming soon)");
    expect(navItemName(NAV_ITEMS.find((i) => i.target === "cities")!)).toBe("Cities");
  });
});
