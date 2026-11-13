import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; displayName: string; emailVerified?: boolean } | null,
  open: true,
  limited: false,
  list: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  barAsked: [] as unknown[],
  hasSeat: true,
  created: true,
  holding: null as null | { trips: { id: string; startDayIndex: number; lock: string | null }[] },
  posted: [] as unknown[],
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => mocks.user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: !mocks.limited }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/trade-board-bar", () => ({
  tradeBoardIsOpen: async (seat: unknown) => {
    mocks.barAsked.push(seat);
    return mocks.open;
  },
}));
vi.mock("@/lib/server/db", () => ({
  listTradeOffersForSeat: mocks.list,
  createTradeOffer: async (o: unknown) => (mocks.posted.push(o), mocks.created),
  pilotHasSeatMonth: async () => mocks.hasSeat,
  getTradeHolding: async () => mocks.holding,
}));

const { GET, POST, BOARD_LIMIT } = await import("./route");

const url = (q: string) => new Request(`https://example.com/api/trades?${q}`);
const SEAT = "base=MEM&aircraft=MD11&seat=CAP&month=NOV26";

beforeEach(() => {
  mocks.user = { id: "pilot-1", displayName: "J Pilot", emailVerified: true };
  mocks.open = true;
  mocks.limited = false;
  mocks.hasSeat = true;
  mocks.created = true;
  mocks.holding = null;
  mocks.posted.length = 0;
  mocks.list.mockClear();
  mocks.barAsked.length = 0;
});

describe("GET /api/trades", () => {
  it("asks for one seat's month, with others' open offers once its board is open", async () => {
    expect((await GET(url(SEAT))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" }, "pilot-1", { othersOpen: true, limit: BOARD_LIMIT });
    expect(mocks.barAsked).toEqual([{ base: "MEM", aircraft: "MD11", seat: "CAP" }]);
  });

  it("gives only the pilot's own offers while the seat's board is closed", async () => {
    mocks.open = false;
    await GET(url(SEAT));
    expect(mocks.list.mock.calls[0][2]).toEqual({ othersOpen: false, limit: BOARD_LIMIT });
  });

  it("needs a seat and month, a signed-in pilot, and a pilot under the limit", async () => {
    expect((await GET(url("base=MEM&aircraft=MD11&seat=CAP"))).status).toBe(400);
    mocks.limited = true;
    expect((await GET(url(SEAT))).status).toBe(429);
    mocks.user = null;
    expect((await GET(url(SEAT))).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("gives only the pilot's own offers for a seat's month they neither hold nor have the pack for", async () => {
    mocks.hasSeat = false;
    expect((await GET(url(SEAT))).status).toBe(200);
    expect(mocks.list.mock.calls[0][2]).toEqual({ othersOpen: false, limit: BOARD_LIMIT });
  });

  it("leaves other pilots' account ids out", async () => {
    mocks.list.mockResolvedValueOnce([{ id: "o1", offeringUserId: "pilot-2", responderUserId: "pilot-1" }]);
    const { offers } = await (await GET(url(SEAT))).json();
    expect(offers[0]).toMatchObject({ offeringUserId: "another-pilot", responderUserId: "pilot-1" });
  });
});

describe("POST /api/trades", () => {
  const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early", creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0, tripId: "p13", startDayIndex: 2 };
  const post = () => POST(new Request("https://example.com/api/trades", { method: "POST", body: JSON.stringify({ bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "CAP", month: "NOV26" }, offeredTrip: trip }) }));

  it("posts an offer", async () => {
    expect((await post()).status).toBe(200);
  });

  it("refuses a seat's month the pilot neither holds nor has the pack for, as reading its board does", async () => {
    mocks.hasSeat = false;
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/bid pack you fly/);
    expect(mocks.posted).toHaveLength(0);
  });

  it("with a holding confirmed, takes only a trip in it the pilot can trade", async () => {
    mocks.holding = { trips: [{ id: "p13", startDayIndex: 9, lock: null }, { id: "p13", startDayIndex: 2, lock: "VLT" }] };
    // The same pairing on another day, and this day marked as one they can't trade.
    expect((await post()).status).toBe(403);
    mocks.holding = { trips: [{ id: "p13", startDayIndex: 2, lock: null }] };
    expect((await post()).status).toBe(200);
    expect(mocks.posted).toHaveLength(1);
  });

  it("refuses a trip the pilot has already agreed to trade", async () => {
    mocks.created = false;
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already agreed/);
  });
});
