import { beforeEach, describe, expect, it, vi } from "vitest";

// Stripe, the database and the signed-in pilot are all faked: no checkout is ever really started.
const db = vi.hoisted(() => ({ getSubscriptionByUserId: vi.fn(), linkStripeCustomer: vi.fn() }));
vi.mock("@/lib/server/db", () => db);
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/same-origin", () => ({ crossSiteRefusal: () => null }));
vi.mock("@/lib/server/auth", () => ({
  getCurrentServerUser: async () => ({ id: "u-1", email: "p@test.invalid", displayName: "P", plan: "pro", createdAt: "" }),
}));
const stripe = vi.hoisted(() => ({ createSession: vi.fn(), createCustomer: vi.fn() }));
vi.mock("@/lib/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/stripe")>()),
  stripeConfig: () => ({ secretKey: "sk_test", priceId: "price_1" }),
  getStripe: () => ({ checkout: { sessions: { create: stripe.createSession } }, customers: { create: stripe.createCustomer } }),
}));

import { POST } from "./route";

const req = () => new Request("https://lineselect.test/api/billing/checkout", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  stripe.createSession.mockResolvedValue({ url: "https://checkout.stripe.test/s" });
});

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
});
