import { describe, expect, it } from "vitest";
import { disabledReason } from "@/components/nav/nav-items";

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
