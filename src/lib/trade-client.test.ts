import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptOffer, fetchTradeBoardOpen, postTradeOffer, respondToOffer } from "./trade-client";

const seat = { base: "MEM", aircraft: "B757", seat: "CAP" };
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("asking whether a seat's board is open", () => {
  it("says open or not yet when the server answers", async () => {
    vi.stubGlobal("fetch", answer(200, { open: true }));
    expect(await fetchTradeBoardOpen(seat)).toBe(true);
    vi.stubGlobal("fetch", answer(200, { open: false }));
    expect(await fetchTradeBoardOpen(seat)).toBe(false);
  });

  it("says it couldn't tell, not \"not yet\", when the check fails", async () => {
    vi.stubGlobal("fetch", answer(500, { error: "busy" }));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
    vi.stubGlobal("fetch", answer(200, {}));
    expect(await fetchTradeBoardOpen(seat)).toBeNull();
  });
});

describe("an action turned away for no membership", () => {
  it("says so, with the server's words, so the board can point to membership rather than just show an error", async () => {
    // Only once FREE_FOR_ALL is off: the server's `accessRefusal`.
    const words = "A Line Select membership unlocks this. Start yours to carry on.";
    vi.stubGlobal("fetch", answer(402, { error: words, upgrade: "/membership" }));
    const trip = { lineNumber: "1", pairingNumber: "13", days: 3, layoverCities: [], international: false, reportTime: "early" as const, creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0 };
    for (const result of [await respondToOffer("o1", trip), await acceptOffer("o1", null), await postTradeOffer({ bidPackMeta: { ...seat, month: "OCT26" }, offeredTrip: trip, wantedPairingNumber: null, note: null })]) {
      expect(result).toEqual({ ok: false, error: words, confirmEmail: false, membership: true });
    }
    vi.stubGlobal("fetch", answer(409, { error: "This offer isn't open anymore." }));
    expect((await acceptOffer("o1", null)).membership).toBe(false);
  });
});
