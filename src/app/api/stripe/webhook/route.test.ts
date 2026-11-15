import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The database is fully mocked — these tests are about the webhook's ordering and dedupe decisions, not SQL.
const db = vi.hoisted(() => ({
  getSubscriptionByCustomerId: vi.fn(),
  getSubscriptionByUserId: vi.fn(),
  markStripeEventProcessed: vi.fn(),
  saveSubscription: vi.fn(),
  setUserPlan: vi.fn(),
  stripeEventProcessed: vi.fn(),
}));
vi.mock("@/lib/server/db", () => db);

const alerts = vi.hoisted(() => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/alerts", () => alerts);

// Signature verification and the subscription retrieve are faked; the pure helpers (snapshotOf, planForStatus…) stay real.
const stripe = vi.hoisted(() => ({
  config: { secret: "whsec_test" as string | undefined, enabled: true },
  constructEventAsync: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/server/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/stripe")>();
  return {
    ...actual,
    webhookSecret: () => stripe.config.secret,
    billingEnabled: () => stripe.config.enabled,
    getStripe: () => ({
      webhooks: { constructEventAsync: stripe.constructEventAsync },
      subscriptions: { retrieve: stripe.retrieve },
    }),
  };
});

import { POST } from "./route";

const req = (signed = true) =>
  new Request("https://lineselect.test/api/stripe/webhook", {
    method: "POST",
    body: "{}",
    headers: signed ? { "stripe-signature": "sig" } : {},
  });

/** A Stripe subscription object of the minimal shape `snapshotOf` reads. */
function sub(opts: { id?: string; customer?: string; status?: string; userId?: string } = {}) {
  return {
    id: opts.id ?? "sub_1",
    customer: opts.customer ?? "cus_1",
    status: opts.status ?? "active",
    trial_end: null,
    items: { data: [{ current_period_end: 1_700_000_000, price: { id: "price_1" } }] },
    metadata: { userId: opts.userId ?? "u-1" },
  } as unknown as Stripe.Subscription;
}

/** `created` is Unix seconds, as Stripe sends it. A subscription carried is also what Stripe has now, unless a test says otherwise. */
function event(type: string, created: number, object: unknown, id = "evt_1"): Stripe.Event {
  if (object && typeof object === "object" && "items" in object) stripe.retrieve.mockResolvedValue(object);
  return { id, type, created, data: { object } } as unknown as Stripe.Event;
}

const secondsAsDate = (s: number) => new Date(s * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  stripe.config.secret = "whsec_test";
  stripe.config.enabled = true;
  db.stripeEventProcessed.mockResolvedValue(false);
  db.getSubscriptionByUserId.mockResolvedValue(null);
  db.getSubscriptionByCustomerId.mockResolvedValue(null);
  db.saveSubscription.mockResolvedValue(undefined);
  db.setUserPlan.mockResolvedValue(undefined);
  db.markStripeEventProcessed.mockResolvedValue(undefined);
});

describe("stripe webhook", () => {
  it("mirrors a new subscription and records the event id", async () => {
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.created", 1000, sub({ status: "trialing" })));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(db.saveSubscription).toHaveBeenCalledWith("u-1", expect.objectContaining({ status: "trialing" }), secondsAsDate(1000));
    expect(db.setUserPlan).toHaveBeenCalledWith("u-1", "pro");
    expect(db.markStripeEventProcessed).toHaveBeenCalledWith("evt_1", "customer.subscription.created");
  });

  it("skips an event id it has already processed, without re-running side effects", async () => {
    db.stripeEventProcessed.mockResolvedValue(true);
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.updated", 2000, sub()));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(db.saveSubscription).not.toHaveBeenCalled();
    expect(db.setUserPlan).not.toHaveBeenCalled();
    expect(db.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("ignores an out-of-order event so a late update can't revive a cancelled membership", async () => {
    // The row was last written by the cancellation at t=3000 (plan now free).
    db.getSubscriptionByUserId.mockResolvedValue({ lastEventAt: secondsAsDate(3000).toISOString(), status: "canceled" });
    // A stale "active" update, created earlier at t=2000, arrives afterwards.
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.updated", 2000, sub({ status: "active" }), "evt_stale"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(db.saveSubscription).not.toHaveBeenCalled();
    expect(db.setUserPlan).not.toHaveBeenCalled(); // membership stays cancelled
    // Still recorded, so Stripe's retries of this stale event stop.
    expect(db.markStripeEventProcessed).toHaveBeenCalledWith("evt_stale", "customer.subscription.updated");
  });

  it("applies an event newer than the row it would replace", async () => {
    db.getSubscriptionByUserId.mockResolvedValue({ lastEventAt: secondsAsDate(1000).toISOString(), status: "trialing" });
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.updated", 5000, sub({ status: "active" })));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(db.saveSubscription).toHaveBeenCalledWith("u-1", expect.objectContaining({ status: "active" }), secondsAsDate(5000));
    expect(db.setUserPlan).toHaveBeenCalledWith("u-1", "pro");
  });

  it("doesn't let an old membership's end overwrite the newer one the pilot is on", async () => {
    // sub_old went past due, the pilot started a fresh membership (sub_new, trialing), then Stripe gave up on sub_old.
    db.getSubscriptionByUserId.mockResolvedValue({ stripeSubscriptionId: "sub_new", status: "trialing", lastEventAt: secondsAsDate(5000).toISOString() });
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.deleted", 6000, sub({ id: "sub_old", status: "canceled" }), "evt_old_end"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(db.saveSubscription).not.toHaveBeenCalled();
    expect(db.setUserPlan).not.toHaveBeenCalled(); // still pro on sub_new
    expect(db.markStripeEventProcessed).toHaveBeenCalledWith("evt_old_end", "customer.subscription.deleted");
  });

  it("does let a new membership replace an old one that lapsed", async () => {
    db.getSubscriptionByUserId.mockResolvedValue({ stripeSubscriptionId: "sub_old", status: "canceled", lastEventAt: secondsAsDate(5000).toISOString() });
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.created", 6000, sub({ id: "sub_new", status: "trialing" })));
    await POST(req());
    expect(db.saveSubscription).toHaveBeenCalledWith("u-1", expect.objectContaining({ stripeSubscriptionId: "sub_new", status: "trialing" }), secondsAsDate(6000));
    expect(db.setUserPlan).toHaveBeenCalledWith("u-1", "pro");
  });

  it("saves the membership as Stripe has it now, when a paid start's two events share a second and come in reversed", async () => {
    // "updated=active" already wrote the row at t=1000; "created=incomplete", also stamped t=1000, arrives after it.
    db.getSubscriptionByUserId.mockResolvedValue({ stripeSubscriptionId: "sub_1", status: "active", lastEventAt: secondsAsDate(1000).toISOString() });
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.created", 1000, sub({ status: "incomplete" }), "evt_created"));
    stripe.retrieve.mockResolvedValue(sub({ status: "active" }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(stripe.retrieve).toHaveBeenCalledWith("sub_1");
    expect(db.saveSubscription).not.toHaveBeenCalledWith("u-1", expect.objectContaining({ status: "incomplete" }), expect.anything());
    expect(db.setUserPlan).not.toHaveBeenCalledWith("u-1", "free"); // a paid pilot isn't told their payment didn't go through
  });

  it("falls back to the event's copy for a membership Stripe no longer has, and fails (to be retried) on any other error", async () => {
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.deleted", 1000, sub({ status: "canceled" })));
    stripe.retrieve.mockRejectedValue(Object.assign(new Error("No such subscription"), { statusCode: 404 }));
    expect((await POST(req())).status).toBe(200);
    expect(db.saveSubscription).toHaveBeenCalledWith("u-1", expect.objectContaining({ status: "canceled" }), secondsAsDate(1000));
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.updated", 1001, sub()));
    stripe.retrieve.mockRejectedValue(Object.assign(new Error("Stripe is down"), { statusCode: 500 }));
    expect((await POST(req())).status).toBe(500);
  });

  it("records (but doesn't act on) an event for a customer we don't know", async () => {
    db.getSubscriptionByCustomerId.mockResolvedValue(null);
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.updated", 1000, sub({ userId: "", customer: "cus_unknown" })));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(db.saveSubscription).not.toHaveBeenCalled();
    expect(db.setUserPlan).not.toHaveBeenCalled();
    expect(db.markStripeEventProcessed).toHaveBeenCalled();
  });

  it("retrieves and applies the subscription behind checkout.session.completed", async () => {
    stripe.retrieve.mockResolvedValue(sub({ id: "sub_9", customer: "cus_9", status: "active", userId: "u-9" }));
    stripe.constructEventAsync.mockResolvedValue(event("checkout.session.completed", 4000, { subscription: "sub_9" }, "evt_co"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(stripe.retrieve).toHaveBeenCalledWith("sub_9");
    expect(db.saveSubscription).toHaveBeenCalledWith("u-9", expect.objectContaining({ status: "active" }), secondsAsDate(4000));
    expect(db.setUserPlan).toHaveBeenCalledWith("u-9", "pro");
  });

  it("rejects a request with no signature", async () => {
    const res = await POST(req(false));
    expect(res.status).toBe(400);
    expect(db.stripeEventProcessed).not.toHaveBeenCalled();
  });

  it("rejects a bad signature and records nothing", async () => {
    stripe.constructEventAsync.mockRejectedValue(new Error("bad signature"));
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(db.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("returns 500 and does NOT record the event when the handler throws, so Stripe retries it", async () => {
    db.saveSubscription.mockRejectedValue(new Error("db down"));
    stripe.constructEventAsync.mockResolvedValue(event("customer.subscription.created", 1000, sub()));
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(alerts.reportProblem).toHaveBeenCalled();
    expect(db.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("returns 503 when billing isn't configured", async () => {
    stripe.config.enabled = false;
    expect((await POST(req())).status).toBe(503);
    stripe.config.enabled = true;
    stripe.config.secret = undefined;
    expect((await POST(req())).status).toBe(503);
  });
});
