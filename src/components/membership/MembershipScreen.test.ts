import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-state", () => ({ useAppState: () => ({ user: null }) }));

import { CheckoutPending, MembershipBody } from "./MembershipScreen";
import { CHECKOUT_CONFIRM_WAITS_MS, checkoutNotLanded, showsProMembership, waitForProMembership, type BillingStatus } from "@/lib/billing";

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

  it("doesn't offer a spot or a paid membership to a pilot who has full access while it's all free", () => {
    // An account made after the cutover is "locked" on the model's merits; with the whole app free it was offered a
    // free spot (one fewer for a new pilot at go-live) and $20/month for what it already had.
    const html = body({ ...base, tier: "locked", hasAccess: true, freeSlotsLeft: 7 });
    expect(html).toContain("full access");
    expect(html).not.toContain("Claim a free spot");
    expect(html).not.toContain("Start free month");
  });

  it("doesn't promise a free member a move to paid that the screen has no button for", () => {
    const html = body({ ...base, tier: "grandfathered", hasAccess: true });
    expect(html).not.toContain("move to a paid membership");
    expect(html).not.toContain("<button");
  });

  it("shows a free member whose membership payment failed the way to fix the card", () => {
    // Stripe goes on trying the card; the free panel had no way to the portal.
    const html = body({ ...base, tier: "grandfathered", hasAccess: true, hasSubscription: true, status: "past_due", freeMonth: false });
    expect(html).toContain("Update your card");
  });

  it("reads out a failed claim or checkout the moment it shows, in every panel", () => {
    // Said nowhere, a screen reader heard the button come back and nothing else.
    const said = (status: BillingStatus) =>
      renderToStaticMarkup(createElement(MembershipBody, { status, busy: false, error: "Couldn't claim a free spot.", onCheckout: () => {}, onPortal: () => {}, onClaimFree: () => {} }));
    for (const status of [
      { ...base, freeSlotsLeft: 3 },
      { ...base, tier: "pro" as const, status: "active" as const },
      { ...base, tier: "pro" as const, status: "active" as const, cancelAtPeriodEnd: true },
      { ...base, hasSubscription: true, status: "past_due" as const },
    ]) {
      expect(said(status)).toMatch(/<p role="alert"[^>]*>Couldn&#x27;t claim a free spot\.<\/p>/);
    }
  });
});

describe("back from checkout before Stripe's word reaches the server", () => {
  // Stripe sends the pilot back before its webhook lands: the first status still said no membership. The screen said
  // "welcome to Line Select Pro" over the offer to start one, and never asked again.
  const trialing: BillingStatus = { ...base, plan: "pro", status: "trialing", hasSubscription: true, tier: "pro", hasAccess: true };

  it("asks again, waiting longer each time, until the status shows the membership", async () => {
    const answers = [base, null, trialing, trialing];
    let asks = 0;
    const slept: number[] = [];
    const got = await waitForProMembership(
      async () => {
        asks++;
        return answers.shift() ?? null;
      },
      { sleep: async (ms) => void slept.push(ms) }
    );
    expect(got).toEqual(trialing);
    expect(asks).toBe(3);
    expect(slept).toEqual(CHECKOUT_CONFIRM_WAITS_MS.slice(0, 3));
    expect(slept[1]).toBeGreaterThan(slept[0]);
  });

  it("stops after its last wait with the last answer it got, and when the screen is gone", async () => {
    let asks = 0;
    const locked = await waitForProMembership(async () => (asks++ ? null : base), { sleep: async () => {} });
    expect(locked).toEqual(base);
    expect(asks).toBe(CHECKOUT_CONFIRM_WAITS_MS.length);
    asks = 0;
    expect(await waitForProMembership(async () => (asks++, base), { sleep: async () => {}, stopped: () => true })).toBeNull();
    expect(asks).toBe(0);
  });

  it("reads a free month, a paid one, or a Pro plan as the membership, and nothing else", () => {
    expect(showsProMembership(trialing)).toBe(true);
    expect(showsProMembership({ ...base, status: "active" })).toBe(true);
    expect(showsProMembership({ ...base, tier: "pro" })).toBe(true);
    expect(showsProMembership(base)).toBe(false);
    expect(showsProMembership({ ...base, tier: "grandfathered", hasAccess: true })).toBe(false);
    expect(showsProMembership(null)).toBe(false);
    // Waited on only while the screen would still offer one: not for a pilot with access some other way.
    expect(checkoutNotLanded(base)).toBe(true);
    expect(checkoutNotLanded(trialing)).toBe(false);
    expect(checkoutNotLanded({ ...base, tier: "grandfathered", hasAccess: true })).toBe(false);
    expect(checkoutNotLanded({ ...base, enabled: false })).toBe(false);
    expect(checkoutNotLanded(null)).toBe(false);
  });

  it("says it's waiting on Stripe instead of offering a membership, then offers to check again", () => {
    const waiting = renderToStaticMarkup(createElement(CheckoutPending, { confirming: true, busy: false, onCheckAgain: () => {} }));
    expect(waiting).toContain("Stripe is confirming your membership");
    expect(waiting).not.toContain("Start free month");
    expect(waiting).not.toContain("<button");
    const late = renderToStaticMarkup(createElement(CheckoutPending, { confirming: false, busy: false, onCheckAgain: () => {} }));
    expect(late).toContain("confirmed your membership yet");
    expect(late).toContain("Check again");
  });
});
