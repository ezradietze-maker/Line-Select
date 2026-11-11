import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; displayName: string } | null,
  open: true,
  limited: false,
  list: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  barAsked: [] as unknown[],
}));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => mocks.user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: !mocks.limited }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/trade-board-bar", () => ({
  tradeBoardIsOpen: async (seat: unknown) => {
    mocks.barAsked.push(seat);
    return mocks.open;
  },
}));
vi.mock("@/lib/server/db", () => ({ listTradeOffersForSeat: mocks.list, createTradeOffer: vi.fn() }));

const { GET, BOARD_LIMIT } = await import("./route");

const url = (q: string) => new Request(`https://example.com/api/trades?${q}`);
const SEAT = "base=MEM&aircraft=MD11&seat=CAP&month=NOV26";

beforeEach(() => {
  mocks.user = { id: "pilot-1", displayName: "J Pilot" };
  mocks.open = true;
  mocks.limited = false;
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

  it("leaves other pilots' account ids out", async () => {
    mocks.list.mockResolvedValueOnce([{ id: "o1", offeringUserId: "pilot-2", responderUserId: "pilot-1" }]);
    const { offers } = await (await GET(url(SEAT))).json();
    expect(offers[0]).toMatchObject({ offeringUserId: "another-pilot", responderUserId: "pilot-1" });
  });
});
