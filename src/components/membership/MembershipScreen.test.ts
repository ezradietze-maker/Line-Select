import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ user: null }) }));

import { MembershipBody } from "./MembershipScreen";

const body = (status: Parameters<typeof MembershipBody>[0]["status"]) =>
  renderToStaticMarkup(createElement(MembershipBody, { status, busy: false, error: null, onCheckout: () => {}, onPortal: () => {} }));

describe("membership screen", () => {
  it("says the membership didn't load when the status fails, not that membership is switched off", () => {
    // A paying pilot offline, or the server failing, was told paid membership isn't on and they're a free member.
    const html = body(null);
    expect(html).toContain("load your membership");
    expect(html).not.toContain("switched on");
  });

  it("still says so when this site has no billing", () => {
    expect(body({ enabled: false, plan: "free", status: null, hasSubscription: false, freeMonth: false, cancelAtPeriodEnd: false, trialEndsAt: null, currentPeriodEnd: null })).toContain("switched on");
  });

  it("shows a trial set to cancel as canceled and ending, not still 'in progress'", () => {
    // A pilot who canceled during their free month was still shown "Free month in progress" with no sign it had ended.
    const html = body({
      enabled: true,
      plan: "pro",
      status: "trialing",
      hasSubscription: true,
      freeMonth: false,
      cancelAtPeriodEnd: true,
      trialEndsAt: "2026-12-15T12:00:00.000Z",
      currentPeriodEnd: null,
    });
    expect(html).toContain("Membership canceled");
    expect(html).toContain("won’t be charged");
    expect(html).not.toContain("Free month in progress");
  });
});
