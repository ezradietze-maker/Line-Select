import { describe, expect, it } from "vitest";
import { landingShownBefore, withLandingShown } from "./landing-return";

describe("coming back to the landing page", () => {
  it("is a first arrival with no mark, whatever the router keeps in the entry", () => {
    expect(landingShownBefore(null)).toBe(false);
    expect(landingShownBefore({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: {} })).toBe(false);
  });

  it("is a return once the entry has shown it, and the router's own state is kept", () => {
    const routerState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ["", {}] } };
    const marked = withLandingShown(routerState);
    expect(landingShownBefore(marked)).toBe(true);
    expect(marked).toMatchObject(routerState);
    expect(landingShownBefore(withLandingShown(null))).toBe(true);
  });
});
