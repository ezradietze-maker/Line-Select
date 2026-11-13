import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { hasProAccess, planForStatus, snapshotOf, userIdFromSubscription } from "@/lib/server/stripe";

describe("planForStatus", () => {
  it("treats a live trial or active subscription as pro", () => {
    expect(planForStatus("trialing")).toBe("pro");
    expect(planForStatus("active")).toBe("pro");
  });

  it("treats every other status as free", () => {
    for (const status of ["past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"]) {
      expect(planForStatus(status)).toBe("free");
    }
  });
});

describe("hasProAccess", () => {
  it("gives every signed-in or signed-out pilot access while free equals pro", () => {
    expect(hasProAccess(null)).toBe(true);
    expect(hasProAccess({ plan: "free" })).toBe(true);
    expect(hasProAccess({ plan: "pro" })).toBe(true);
  });
});

describe("snapshotOf", () => {
  it("flattens a subscription, reading the period end off the line item", () => {
    const sub = {
      id: "sub_123",
      customer: "cus_123",
      status: "trialing",
      trial_end: 1_700_000_000,
      items: { data: [{ current_period_end: 1_701_000_000, price: { id: "price_abc" } }] },
      metadata: { userId: "u-1" },
    } as unknown as Stripe.Subscription;

    const snap = snapshotOf(sub);
    expect(snap.stripeCustomerId).toBe("cus_123");
    expect(snap.stripeSubscriptionId).toBe("sub_123");
    expect(snap.status).toBe("trialing");
    expect(snap.priceId).toBe("price_abc");
    expect(snap.currentPeriodEnd?.getTime()).toBe(1_701_000_000 * 1000);
    expect(snap.trialEndsAt?.getTime()).toBe(1_700_000_000 * 1000);
    expect(userIdFromSubscription(sub)).toBe("u-1");
  });

  it("handles a customer given as an object, no trial, and a missing period end", () => {
    const sub = {
      id: "sub_x",
      customer: { id: "cus_x" },
      status: "active",
      trial_end: null,
      items: { data: [{ price: { id: "price_x" } }] },
      metadata: {},
    } as unknown as Stripe.Subscription;

    const snap = snapshotOf(sub);
    expect(snap.stripeCustomerId).toBe("cus_x");
    expect(snap.currentPeriodEnd).toBeNull();
    expect(snap.trialEndsAt).toBeNull();
    expect(userIdFromSubscription(sub)).toBeNull();
  });
});
