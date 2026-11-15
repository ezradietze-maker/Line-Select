import { beforeEach, describe, expect, it, vi } from "vitest";

// Stripe, the database and the signed-in pilot are all faked: no portal is ever really opened.
const db = vi.hoisted(() => ({ getSubscriptionByUserId: vi.fn() }));
vi.mock("@/lib/server/db", () => db);
const alerts = vi.hoisted(() => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/alerts", () => alerts);
vi.mock("@/lib/server/same-origin", () => ({ crossSiteRefusal: () => null }));
vi.mock("@/lib/server/auth", () => ({
  getCurrentServerUser: async () => ({ id: "u-1", email: "p@test.invalid", displayName: "P", plan: "free", createdAt: "" }),
}));
const stripe = vi.hoisted(() => ({ createPortal: vi.fn(), retrieveCustomer: vi.fn() }));
vi.mock("@/lib/server/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/stripe")>()),
  billingEnabled: () => true,
  getStripe: () => ({
    billingPortal: { sessions: { create: stripe.createPortal } },
    customers: { retrieve: stripe.retrieveCustomer },
  }),
}));

import { POST } from "./route";

const req = () => new Request("https://lineselect.test/api/billing/portal", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  db.getSubscriptionByUserId.mockResolvedValue({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "canceled" });
  stripe.createPortal.mockResolvedValue({ url: "https://billing.stripe.test/p" });
  stripe.retrieveCustomer.mockImplementation(async (id: string) => ({ id, object: "customer" }));
});

describe("the billing portal", () => {
  it("opens Stripe's portal for the pilot's customer", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://billing.stripe.test/p" });
    expect(stripe.createPortal).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }));
  });

  it("says the billing at Stripe was closed, not \"try again in a moment\", when the customer was deleted there", async () => {
    stripe.createPortal.mockRejectedValue(Object.assign(new Error("No such customer: 'cus_1'"), { code: "resource_missing" }));
    for (const gone of [async () => ({ id: "cus_1", object: "customer", deleted: true }), async () => Promise.reject(Object.assign(new Error("No such customer"), { code: "resource_missing" }))]) {
      stripe.retrieveCustomer.mockImplementation(gone);
      const res = await POST(req());
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ customerGone: true });
      expect(body.error).toMatch(/Start a new membership/);
    }
    expect(alerts.reportProblem).not.toHaveBeenCalled();
  });

  it("still says try again, and reports it, when Stripe just didn't answer", async () => {
    stripe.createPortal.mockRejectedValue(new Error("timeout"));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(alerts.reportProblem).toHaveBeenCalledTimes(1);
    // Not answering the customer lookup either: the same.
    stripe.retrieveCustomer.mockRejectedValue(new Error("timeout"));
    expect((await POST(req())).status).toBe(503);
  });
});
