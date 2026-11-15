import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ user: null }) }));

import { MembershipBody } from "./MembershipScreen";
import type { BillingStatus } from "@/lib/billing";

const base: BillingStatus = {
  enabled: true,
  plan: "free",
  status: null,
  hasSubscription: false,
  freeMonth: true,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  tier: "locked",
  hasAccess: false,
  freeSlotsLeft: 0,
};

const body = (status: BillingStatus | null) =>
  renderToStaticMarkup(
    createElement(MembershipBody, { status, busy: false, error: null, onCheckout: () => {}, onPortal: () => {}, onClaimFree: () => {} })
  );

describe("membership screen", () => {
  it("says the membership didn't load when the status fails, not that membership is switched off", () => {
    // A paying pilot offline, or the server failing, was told paid membership isn't on and they're a free member.
    const html = body(null);
    expect(html).toContain("load your membership");
    expect(html).not.toContain("switched on");
  });

  it("still says so when this site has no billing", () => {
    expect(body({ ...base, enabled: false })).toContain("switched on");
  });

  it("shows a trial set to cancel as canceled and ending, not still 'in progress'", () => {
    // A pilot who canceled during their free month was still shown "Free month in progress" with no sign it had ended.
    const html = body({
      ...base,
      status: "trialing",
      hasSubscription: true,
      freeMonth: false,
      cancelAtPeriodEnd: true,
      tier: "pro",
      hasAccess: true,
      trialEndsAt: "2026-12-15T12:00:00.000Z",
    });
    expect(html).toContain("Membership canceled");
    expect(html).toContain("won’t be charged");
    expect(html).not.toContain("Free month in progress");
  });

  it("shows a grandfathered pilot as a free member with full access", () => {
    const html = body({ ...base, tier: "grandfathered", hasAccess: true });
    expect(html).toContain("Free member");
    expect(html).toContain("full access");
  });

  it("offers a free spot while slots remain", () => {
    const html = body({ ...base, tier: "locked", freeSlotsLeft: 7 });
    expect(html).toContain("Claim a free spot");
    expect(html).toContain("7 of 15 left");
  });
});
