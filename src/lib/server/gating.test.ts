import { describe, expect, it, vi } from "vitest";

// hasProAccess is the one plan question; stub it so we can exercise both sides of the gate
// regardless of the FREE_FOR_ALL flag that forces it true in the real module.
const stripe = vi.hoisted(() => ({ hasProAccess: vi.fn() }));
vi.mock("@/lib/server/stripe", () => stripe);

import { PRO_FEATURES, canUseProFeature, proFeatureRefusal } from "@/lib/server/gating";

describe("proFeatureRefusal", () => {
  it("lets a member through (returns null)", () => {
    stripe.hasProAccess.mockReturnValue(true);
    expect(proFeatureRefusal({ plan: "pro" }, "trade-board")).toBeNull();
  });

  it("turns a non-member away with a 402 that names the feature and points at /membership", async () => {
    stripe.hasProAccess.mockReturnValue(false);
    const res = proFeatureRefusal({ plan: "free" }, "trade-board");
    expect(res?.status).toBe(402);
    const body = await res!.json();
    expect(body.feature).toBe("trade-board");
    expect(body.error).toContain(PRO_FEATURES["trade-board"]);
    expect(body.upgrade).toBe("/membership");
  });
});

describe("canUseProFeature", () => {
  it("follows hasProAccess for every listed feature", () => {
    stripe.hasProAccess.mockReturnValue(true);
    for (const feature of Object.keys(PRO_FEATURES) as (keyof typeof PRO_FEATURES)[]) {
      expect(canUseProFeature({ plan: "pro" }, feature)).toBe(true);
    }
    stripe.hasProAccess.mockReturnValue(false);
    expect(canUseProFeature({ plan: "free" }, "open-time")).toBe(false);
    expect(canUseProFeature(null, "open-time")).toBe(false);
  });
});
