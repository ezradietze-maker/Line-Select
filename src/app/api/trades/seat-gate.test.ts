import { describe, expect, it, vi } from "vitest";

/**
 * A pilot who flies MD11 FO, with that pack on their account and nothing else, trying every way onto the B777 CAP
 * board: posting to it, answering an offer on it, and saving a holding that names it so that reading it opens up.
 */
const PILOT = "11111111-1111-4111-8111-111111111111";
const MD11_FO_PACK = "uploaded-mem-md11-fo-oct26";
const B777_CAP = { base: "MEM", aircraft: "B777", seat: "CAP", month: "OCT26" };

const state = vi.hoisted(() => ({ saved: [] as { packId: string; bidPackMeta: Record<string, string> }[], created: [] as unknown[], responded: [] as unknown[] }));
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => ({ id: PILOT, displayName: "MD11 FO" }) }));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn() }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRateLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/trade-board-bar", () => ({ tradeBoardIsOpen: async () => true }));
vi.mock("@/lib/server/trade-pack", () => ({ accountPackFingerprint: async () => null }));
vi.mock("@/lib/server/trade-suggestions", () => ({ lapseSuggestionsFor: async () => undefined }));
vi.mock("@/lib/server/db", async () => {
  const { packIdFor } = await import("@/lib/pack-id");
  return {
    saveTradeHolding: async (_u: string, h: { packId: string; bidPackMeta: Record<string, string> }) => (state.saved.push(h), h),
    getTradeHolding: async () => null,
    getTradeSettings: async () => ({ suggestMe: true, emailMatches: false }),
    deleteTradeHolding: async () => undefined,
    getBidPackRecord: async () => ({ packId: MD11_FO_PACK, data: Buffer.from(""), updatedAt: "", fingerprint: null }),
    // As the real one: a holding under the seat's own pack id with that seat, or the seat's pack on the account.
    pilotHasSeatMonth: async (_u: string, meta: { base: string; aircraft: string; seat: string; month: string }) => {
      const id = packIdFor({ ...meta, seat: meta.seat as "CAP" });
      return state.saved.some((h) => h.packId === id && JSON.stringify(h.bidPackMeta) === JSON.stringify(meta)) || id === MD11_FO_PACK;
    },
    createTradeOffer: async (o: unknown) => (state.created.push(o), true),
    findTradeOffer: async () => ({ id: "o1", bidPackMeta: B777_CAP, offeringUserId: "someone-else", offeredTrip: {}, wantedPairingNumber: null, status: "open" }),
    respondToTradeOffer: async (...args: unknown[]) => (state.responded.push(args), null),
    listTradeOffersForSeat: async (_m: unknown, _v: string, opts: { othersOpen: boolean }) =>
      opts.othersOpen ? [{ id: "x", offeringUserId: "someone-else", offeringDisplayName: "B777 CAP pilot", note: "private note", status: "open", bidPackMeta: B777_CAP }] : [],
  };
});

const holding = await import("@/app/api/trades/holding/route");
const board = await import("@/app/api/trades/route");
const respond = await import("@/app/api/trades/[id]/respond/route");

const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: ["ANC"], international: false, reportTime: "early", creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0 };
const readB777Board = async () => (await (await board.GET(new Request("https://x/api/trades?base=MEM&aircraft=B777&seat=CAP&month=OCT26"))).json()).offers;

describe("a seat's trade board, for a pilot who doesn't fly that seat", () => {
  it("can't be posted to", async () => {
    const res = await board.POST(new Request("https://x/api/trades", { method: "POST", body: JSON.stringify({ bidPackMeta: B777_CAP, offeredTrip: trip }) }));
    expect(res.status).toBe(403);
    expect(state.created).toHaveLength(0);
  });

  it("can't have an offer on it answered", async () => {
    const res = await respond.POST(new Request("https://x/api/trades/o1/respond", { method: "POST", body: JSON.stringify({ responderTrip: trip }) }), { params: Promise.resolve({ id: "o1" }) });
    expect(res.status).toBe(403);
    expect(state.responded).toHaveLength(0);
  });

  it("isn't opened by a holding that names it under another pack's id, or under its own without the pack", async () => {
    expect(await readB777Board()).toHaveLength(0);
    const put = (packId: string) => holding.PUT(new Request("https://x/api/trades/holding", { method: "PUT", body: JSON.stringify({ packId, bidPackMeta: B777_CAP, lineNumber: null, trips: [{ id: "anything", startDayIndex: 0, lock: null }] }) }));
    expect((await put(MD11_FO_PACK)).status).toBe(400);
    expect((await put("uploaded-mem-b777-cap-oct26")).status).toBe(409);
    expect(state.saved).toHaveLength(0);
    expect(await readB777Board()).toHaveLength(0);
  });

  it("still lets them post on their own seat's board", async () => {
    const res = await board.POST(new Request("https://x/api/trades", { method: "POST", body: JSON.stringify({ bidPackMeta: { base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" }, offeredTrip: trip }) }));
    expect(res.status).toBe(200);
  });
});
