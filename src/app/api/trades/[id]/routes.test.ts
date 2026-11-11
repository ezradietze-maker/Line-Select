import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeOffer } from "@/types/trade";

const mocks = vi.hoisted(() => ({
  user: { id: "pilot-1", displayName: "J Pilot" } as { id: string; displayName: string } | null,
  offer: null as unknown,
  respond: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  accept: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => mocks.user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/db", () => ({ findTradeOffer: async () => mocks.offer, respondToTradeOffer: mocks.respond, acceptTradeOffer: mocks.accept }));

const { POST: respond } = await import("./respond/route");
const { POST: accept } = await import("./accept/route");

const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early", creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0, tripId: "p13", startDayIndex: 2 };
const offer = (over: Partial<TradeOffer> = {}) =>
  ({ id: "o1", bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" }, offeringUserId: "pilot-2", offeredTrip: trip, wantedPairingNumber: null, status: "open", ...over }) as TradeOffer;
const params = { params: Promise.resolve({ id: "o1" }) };
const body = (b: unknown) => new Request("https://example.com/api/trades/o1/x", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "pilot-1", displayName: "J Pilot" };
});

describe("a trip already traded this month", () => {
  it("can't be proposed on an offer", async () => {
    mocks.offer = offer();
    mocks.respond.mockResolvedValue("traded");
    const res = await respond(body({ responderTrip: trip }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in a trade/);
    expect(mocks.respond).toHaveBeenCalledWith("o1", mocks.user, expect.objectContaining({ pairingNumber: "13" }));
  });

  it("can't be agreed", async () => {
    mocks.offer = offer({ offeringUserId: "pilot-1", status: "pending" });
    mocks.accept.mockResolvedValue("traded");
    const res = await accept(body({ respondedAt: null }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in a trade/);
  });

  it("leaves a proposal that's fine to go through", async () => {
    mocks.offer = offer();
    mocks.respond.mockResolvedValue(offer({ status: "pending", responderUserId: "pilot-1" }));
    expect((await respond(body({ responderTrip: trip }), params)).status).toBe(200);
  });
});
