import { beforeEach, describe, expect, it, vi } from "vitest";

// Stripe, the database and the signed-in pilot are all faked: no checkout is ever really started.
const db = vi.hoisted(() => ({ getSubscriptionByUserId: vi.fn(), linkStripeCustomer: vi.fn() }));
vi.mock("@/lib/server/db", () => db);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/same-origin", () => ({ crossSiteRefusal: () => null }));
vi.mock("@/lib/server/auth", () => ({
  getCurrentServerUser: async () => ({ id: "u-1", email: "p@test.invalid", displayName: "P", plan: "pro", createdAt: "" }),
}));
const stripe = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  expireSession: vi.fn(),
  createCustomer: vi.fn(),
  listCustomers: vi.fn(),
  listSubscriptions: vi.fn(),
}));
vi.mock("@/lib/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/stripe")>()),
  stripeConfig: () => ({ secretKey: "sk_test", priceId: "price_1" }),
  getStripe: () => ({
    checkout: { sessions: { create: stripe.createSession, list: stripe.listSessions, expire: stripe.expireSession } },
    customers: { create: stripe.createCustomer, list: stripe.listCustomers },
    subscriptions: { list: stripe.listSubscriptions },
  }),
}));

import { POST } from "./route";

const req = () => new Request("https://lineselect.test/api/billing/checkout", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  stripe.createSession.mockResolvedValue({ id: "cs_1", created: 1000, url: "https://checkout.stripe.test/s" });
  stripe.listSessions.mockResolvedValue({ data: [] });
  stripe.expireSession.mockResolvedValue({});
  db.linkStripeCustomer.mockImplementation(async (_userId: string, customerId: string) => customerId);
  stripe.createCustomer.mockResolvedValue({ id: "cus_new" });
  stripe.listCustomers.mockResolvedValue({ data: [] });
  stripe.listSubscriptions.mockResolvedValue({ data: [] });
});

const trialOf = () => (stripe.createSession.mock.calls[0][0] as { subscription_data: { trial_period_days?: number } }).subscription_data.trial_period_days;

describe("start a membership", () => {
  it("won't start a second membership for a pilot already on one", async () => {
    // A second tab still showing "Start free month" after the first tab finished checkout.
    db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "trialing" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("starts one for a pilot whose last membership ended", async () => {
    db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "canceled" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(stripe.createSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
  });

  it("won't start a second beside one that's past due, or otherwise still open: the card is fixed in the portal", async () => {
    for (const status of ["past_due", "unpaid", "incomplete", "paused"]) {
      db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status, trialEndsAt: null });
      const res = await POST(req());
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ fixCard: true });
    }
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("gives the free month to a pilot's first membership only", async () => {
    db.getSubscriptionByUserId.mockResolvedValue(null);
    expect((await POST(req())).status).toBe(200);
    expect(trialOf()).toBe(30);

    // Cancelled, and starting again: no second free month.
    vi.clearAllMocks();
    stripe.createSession.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "canceled", trialEndsAt: "2026-12-01T00:00:00.000Z" });
    expect((await POST(req())).status).toBe(200);
    expect(trialOf()).toBeUndefined();
  });

  it("gives no free month when Stripe already has a membership under the pilot's address (an account made again)", async () => {
    db.getSubscriptionByUserId.mockResolvedValue(null);
    stripe.listCustomers.mockResolvedValue({ data: [{ id: "cus_old" }] });
    stripe.listSubscriptions.mockImplementation(async ({ customer }: { customer: string }) => ({ data: customer === "cus_old" ? [{ id: "sub_old" }] : [] }));
    expect((await POST(req())).status).toBe(200);
    expect(stripe.listCustomers).toHaveBeenCalledWith(expect.objectContaining({ email: "p@test.invalid" }));
    expect(trialOf()).toBeUndefined();
  });

  it("won't start a second when the first finished in another tab a moment ago and Stripe hasn't told us yet", async () => {
    // Our row still has only the customer; Stripe already has the membership the other tab started.
    db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: null, status: "incomplete", trialEndsAt: null });
    stripe.listSubscriptions.mockResolvedValue({ data: [{ id: "sub_1", status: "trialing" }] });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(stripe.createSession).not.toHaveBeenCalled();
  });

  it("leaves one checkout to finish: one left open in another tab is expired", async () => {
    db.getSubscriptionByUserId.mockResolvedValue(null);
    stripe.createSession.mockResolvedValue({ id: "cs_new", created: 2000, url: "https://checkout.stripe.test/new" });
    stripe.listSessions.mockResolvedValue({ data: [{ id: "cs_new", created: 2000, url: "https://checkout.stripe.test/new" }, { id: "cs_old", created: 1000, url: "https://checkout.stripe.test/old" }] });
    const res = await POST(req());
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/new" });
    expect(stripe.listSessions).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_new", status: "open" }));
    expect(stripe.expireSession).toHaveBeenCalledWith("cs_old");
    expect(stripe.expireSession).toHaveBeenCalledTimes(1);
  });

  it("sends two checkouts started at once to the same one, and expires the other", async () => {
    db.getSubscriptionByUserId.mockResolvedValue(null);
    // A double tap: this request made cs_a, the other made cs_b in the same second.
    stripe.createSession.mockResolvedValue({ id: "cs_a", created: 2000, url: "https://checkout.stripe.test/a" });
    stripe.listSessions.mockResolvedValue({ data: [{ id: "cs_b", created: 2000, url: "https://checkout.stripe.test/b" }, { id: "cs_a", created: 2000, url: "https://checkout.stripe.test/a" }] });
    const res = await POST(req());
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/b" });
    expect(stripe.expireSession).toHaveBeenCalledWith("cs_a");
    expect(stripe.expireSession).not.toHaveBeenCalledWith("cs_b");
  });

  it("goes on with the customer linked first when two checkouts made one each at once", async () => {
    db.getSubscriptionByUserId.mockResolvedValue(null);
    db.linkStripeCustomer.mockResolvedValue("cus_first");
    expect((await POST(req())).status).toBe(200);
    expect(stripe.createSession).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_first" }));
    expect(stripe.listSessions).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_first" }));
  });
});
