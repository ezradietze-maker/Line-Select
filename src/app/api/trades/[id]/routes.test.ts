import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeOffer } from "@/types/trade";

const mocks = vi.hoisted(() => ({
  user: { id: "pilot-1", displayName: "J Pilot", emailVerified: true } as { id: string; displayName: string; emailVerified?: boolean } | null,
  offer: null as unknown,
  respond: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  accept: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  hasSeat: true,
  holding: null as null | { trips: { id: string; startDayIndex: number; lock: string | null }[] },
  holdings: {} as Record<string, { trips: { id: string; startDayIndex: number; lock: string | null }[] }>,
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => mocks.user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/db", () => ({
  findTradeOffer: async () => mocks.offer,
  respondToTradeOffer: mocks.respond,
  acceptTradeOffer: mocks.accept,
  pilotHasSeatMonth: async () => mocks.hasSeat,
  getTradeHolding: async (userId: string) => mocks.holdings[userId] ?? mocks.holding,
  getBidPackRecord: async () => null,
}));

const { POST: respond } = await import("./respond/route");
const { POST: accept } = await import("./accept/route");

const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early" as const, creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0, tripId: "p13", startDayIndex: 2 };
const offer = (over: Partial<TradeOffer> = {}) =>
  ({ id: "o1", bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" }, offeringUserId: "pilot-2", offeredTrip: trip, wantedPairingNumber: null, status: "open", ...over }) as TradeOffer;
const params = { params: Promise.resolve({ id: "o1" }) };
const body = (b: unknown) => new Request("https://example.com/api/trades/o1/x", { method: "POST", body: JSON.stringify(b) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "pilot-1", displayName: "J Pilot", emailVerified: true };
  mocks.hasSeat = true;
  mocks.holding = null;
  mocks.holdings = {};
});

describe("a trip past its trade deadline (25.L.9.a.ii)", () => {
  const flown = { ...trip, date: "2026-01-05" };

  it("can't be proposed on an offer, or proposed with", async () => {
    mocks.offer = offer({ offeredTrip: flown });
    expect((await respond(body({ responderTrip: trip }), params)).status).toBe(409);
    mocks.offer = offer();
    const res = await respond(body({ responderTrip: flown }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Too late to trade/);
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("can't be agreed", async () => {
    mocks.offer = offer({ offeringUserId: "pilot-1", status: "pending", responderUserId: "pilot-3", responderTrip: flown });
    const res = await accept(body({ respondedAt: null }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Too late to trade/);
    expect(mocks.accept).not.toHaveBeenCalled();
  });
});

describe("agreeing a trade", () => {
  const proposed = () => offer({ offeringUserId: "pilot-1", status: "pending", responderUserId: "pilot-3", responderTrip: { ...trip, pairingNumber: "27", tripId: "p27", startDayIndex: 6 } });

  it("is refused when the proposing pilot no longer holds the trip they gave", async () => {
    mocks.offer = proposed();
    mocks.holdings = { "pilot-1": { trips: [{ id: "p13", startDayIndex: 2, lock: null }] }, "pilot-3": { trips: [{ id: "p99", startDayIndex: 6, lock: null }] } };
    const res = await accept(body({ respondedAt: null }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't on what its pilot holds/);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("is refused when the offering pilot no longer holds their own trip", async () => {
    mocks.offer = proposed();
    mocks.holdings = { "pilot-1": { trips: [{ id: "p13", startDayIndex: 9, lock: null }] } };
    expect((await accept(body({ respondedAt: null }), params)).status).toBe(409);
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("goes ahead while both still hold their trips", async () => {
    mocks.offer = proposed();
    mocks.holdings = { "pilot-1": { trips: [{ id: "p13", startDayIndex: 2, lock: null }] }, "pilot-3": { trips: [{ id: "p27", startDayIndex: 6, lock: null }] } };
    mocks.accept.mockResolvedValue(offer({ status: "accepted" }));
    expect((await accept(body({ respondedAt: null }), params)).status).toBe(200);
  });
});

describe("answering an offer", () => {
  it("is only for a pilot who flies the offer's seat and month", async () => {
    mocks.offer = offer();
    mocks.hasSeat = false;
    const res = await respond(body({ responderTrip: trip }), params);
    expect(res.status).toBe(403);
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("with a holding confirmed, only with a trip in it", async () => {
    mocks.offer = offer();
    mocks.holding = { trips: [{ id: "p99", startDayIndex: 2, lock: null }] };
    expect((await respond(body({ responderTrip: trip }), params)).status).toBe(403);
    expect(mocks.respond).not.toHaveBeenCalled();
  });
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
