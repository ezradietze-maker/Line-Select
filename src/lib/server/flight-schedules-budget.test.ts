import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("@/lib/server/kv", () => ({
  getJson: async (key: string) => store.get(key) ?? null,
  setJson: async (key: string, value: unknown) => void store.set(key, value),
}));

const { answerTravelNeeds, boardCostUsd } = await import("./flight-schedules");

const departAfter = Date.now() + 3 * 24 * 3600_000;
const need = { id: "n1", tripId: "t1", kind: "toBase" as const, from: ["XNA", "BNA", "STL"], to: ["MEM"], departAfter, departBefore: departAfter + 3600_000 };

const paidCalls = vi.fn();

beforeEach(() => {
  store.clear();
  paidCalls.mockReset();
  process.env.AERODATABOX_API_KEY = "test";
  vi.stubGlobal("fetch", async () => {
    paidCalls();
    return new Response(null, { status: 204, headers: { "x-api-units-remaining": "30000" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AERODATABOX_API_KEY;
  delete process.env.FLIGHT_BOARD_USD;
});

describe("a lookup's board budget", () => {
  it("makes no paid call at all with nothing left in the budget", async () => {
    const { stats } = await answerTravelNeeds([need], [], { maxBoards: 0 });
    expect(paidCalls).not.toHaveBeenCalled();
    expect(stats.fetched).toBe(0);
    expect(stats.skipped).toBeGreaterThan(0);
  });

  it("stops at the budget, whatever the lookup wanted", async () => {
    const { stats } = await answerTravelNeeds([need], [], { maxBoards: 2 });
    expect(paidCalls).toHaveBeenCalledTimes(2);
    expect(stats.fetched).toBe(2);
    expect(stats.skipped).toBeGreaterThan(0);
  });

  it("doesn't charge a board already cached against the budget", async () => {
    await answerTravelNeeds([need], [], { maxBoards: 2 });
    paidCalls.mockClear();
    const { stats } = await answerTravelNeeds([need], [], { maxBoards: 0 });
    expect(paidCalls).not.toHaveBeenCalled();
    expect(stats.cached).toBeGreaterThanOrEqual(2);
  });
});

describe("a board the provider failed to send", () => {
  it("leaves the answer open, not a no", async () => {
    // SAN has a flight to Denver, and Denver's board fails: the connection on to Memphis is unknown, not missing.
    const at = (h: number) => departAfter + h * 3600_000;
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
    vi.stubGlobal("fetch", async (url: string) => {
      paidCalls();
      if (url.includes("/iata/DEN/")) return new Response("boom", { status: 500 });
      if (url.includes("/iata/SAN/") && url.includes("Departure"))
        return Response.json(
          { departures: [{ number: "UA 1", departure: { scheduledTime: { utc: iso(at(1)) } }, arrival: { airport: { iata: "DEN" }, scheduledTime: { utc: iso(at(3.5)) } } }] },
          { headers: { "x-api-units-remaining": "30000" } }
        );
      return new Response(null, { status: 204, headers: { "x-api-units-remaining": "30000" } });
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await answerTravelNeeds([{ id: "n2", tripId: "t2", kind: "toBase", from: ["SAN"], to: ["MEM"], departAfter, departBefore: at(8), arriveBy: at(8) }], [], {});
    expect(out.answers[0]?.options ?? 0).toBe(0);
    expect(out.stats.skipped).toBeGreaterThan(0);
  });
});

describe("what a board costs", () => {
  it("is its share of the $19.99, 40,000-unit plan at 2 units a board, unless the environment says otherwise", () => {
    expect(boardCostUsd()).toBeCloseTo(0.001, 5);
    process.env.FLIGHT_BOARD_USD = "0.002";
    expect(boardCostUsd()).toBe(0.002);
  });
});
