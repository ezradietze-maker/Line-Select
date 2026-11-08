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

describe("what a board costs", () => {
  it("is its share of the $19.99, 40,000-unit plan at 2 units a board, unless the environment says otherwise", () => {
    expect(boardCostUsd()).toBeCloseTo(0.001, 5);
    process.env.FLIGHT_BOARD_USD = "0.002";
    expect(boardCostUsd()).toBe(0.002);
  });
});
