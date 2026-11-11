import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

// What each pilot would gain, by trip: the graph logic under test, without the scoring in the way.
const gains = vi.hoisted(() => ({ table: new Map<string, number>() }));
vi.mock("@/lib/trades/value", () => ({
  valueSwaps: (_p: unknown, line: { lineNumber: string }, _m: unknown, swaps: { give: { id: string }; take: { id: string } }[]) =>
    swaps.map((s) => ({ give: s.give, take: s.take, before: 50, after: 50, gain: gains.table.get(`${line.lineNumber}:${s.give.id}>${s.take.id}`) ?? -1, creditChange: 0, daysOffChange: 0, reasons: [] })),
}));

const { findTrades } = await import("@/lib/trades/match");

const pack = { id: "p", base: "MEM", month: "OCT26", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, lines: [] } as unknown as BidPack;
const now = Date.UTC(2026, 8, 20);
const model = {} as PilotModel;

function trip(id: string, startDayIndex: number): Trip {
  return { id, startDayIndex, tafbHours: 48, days: 2, creditHours: 10, schedule: [{ reportTimeLocal: "1000", startMinutes: 0, legs: [], layover: null }] } as unknown as Trip;
}

/** A pilot holding one trip, all on the same dates unless said otherwise, so holding two at once would conflict. */
function pilot(n: number, day = 5) {
  return { pilotId: `P${n}`, model, line: { lineNumber: `L${n}`, trips: [trip(`t${n}`, day)] } as unknown as Line };
}

const wants = (n: number, of: number, gain = 3) => gains.table.set(`L${n}:t${n}>t${of}`, gain);

beforeEach(() => gains.table.clear());

describe("finding trades", () => {
  it("finds a straight swap when both pilots gain", () => {
    wants(1, 2);
    wants(2, 1);
    const { trades } = findTrades(pack, [pilot(1), pilot(2)], { now });
    expect(trades).toHaveLength(1);
    expect(trades[0].legs.map((l) => l.pilotId).sort()).toEqual(["P1", "P2"]);
    expect(trades[0].plan.steps).toHaveLength(1);
  });

  it("stops at its deadline and says what it found is partial", () => {
    wants(1, 2);
    wants(2, 1);
    const late = findTrades(pack, [pilot(1), pilot(2)], { now, deadline: Date.now() - 1 });
    expect(late.trades).toEqual([]);
    expect(late.truncated).toBe(true);
  });

  it("offers nothing when only one side gains", () => {
    wants(1, 2);
    expect(findTrades(pack, [pilot(1), pilot(2)], { now }).trades).toEqual([]);
  });

  it.each([3, 4, 5])("finds a chain of %i when no shorter trade exists, your example at 4", (size) => {
    for (let i = 1; i <= size; i++) wants(i, (i % size) + 1);
    const { trades } = findTrades(pack, Array.from({ length: size }, (_, i) => pilot(i + 1)), { now });
    expect(trades).toHaveLength(1);
    expect(trades[0].legs).toHaveLength(size);
    expect(trades[0].plan.steps).toHaveLength(size - 1);
    for (const leg of trades[0].legs) expect(leg.value.gain).toBeGreaterThanOrEqual(1);
  });

  it("still finds a swap between two pilots when a crowd of other chains hits the search limit", () => {
    const crowd = 12;
    for (let i = 1; i <= crowd; i++) for (let j = 1; j <= crowd; j++) if (i !== j) wants(i, j);
    wants(21, 22);
    wants(22, 21);
    const pilots = [...Array.from({ length: crowd }, (_, i) => pilot(i + 1)), pilot(21), pilot(22)];
    const { options, truncated } = findTrades(pack, pilots, { now, maxCycles: 200 });
    expect(truncated).toBe(true);
    expect(options.some((o) => o.legs.map((l) => l.pilotId).sort().join() === "P21,P22")).toBe(true);
  });

  it("stops at 5 pilots", () => {
    for (let i = 1; i <= 6; i++) wants(i, (i % 6) + 1);
    expect(findTrades(pack, Array.from({ length: 6 }, (_, i) => pilot(i + 1)), { now }).options).toEqual([]);
  });

  it("drops a chain if any one pilot's gain is too small to count", () => {
    wants(1, 2);
    wants(2, 3);
    wants(3, 1, 0.5);
    expect(findTrades(pack, [pilot(1), pilot(2), pilot(3)], { now }).trades).toEqual([]);
  });

  it("uses each pilot once, choosing the set worth the most in all", () => {
    // P2 could swap with P1 (worth 10) or with P3 (worth 8), but P1-P4 and P2-P3 together are worth more.
    wants(1, 2, 5);
    wants(2, 1, 5);
    wants(2, 3, 4);
    wants(3, 2, 4);
    wants(1, 4, 4);
    wants(4, 1, 4);
    const { trades } = findTrades(pack, [pilot(1), pilot(2), pilot(3), pilot(4)], { now });
    const pairs = trades.map((t) => t.legs.map((l) => l.pilotId).sort().join("+")).sort();
    expect(pairs).toEqual(["P1+P4", "P2+P3"]);
  });

  it("prefers a swap to a chain of the same total gain, since a chain takes more trades", () => {
    // The swap: 3 + 3. The chain 1 > 3 > 2 > 1: 2 + 1 + 3, the same 6, but two trades instead of one.
    wants(1, 2, 3);
    wants(2, 1, 3);
    wants(1, 3, 2);
    wants(3, 2, 1);
    const { options } = findTrades(pack, [pilot(1), pilot(2), pilot(3)], { now });
    expect(options.map((o) => o.legs.length)).toEqual([2, 3]);
  });

  it("asks more of a pilot who said an earlier trade wasn't worth it", () => {
    wants(1, 2, 3);
    wants(2, 1, 3);
    expect(findTrades(pack, [pilot(1), pilot(2)], { now, minGainFor: (id) => (id === "P1" ? 4 : undefined) }).trades).toEqual([]);
    expect(findTrades(pack, [pilot(1), pilot(2)], { now, minGainFor: (id) => (id === "P1" ? 3 : undefined) }).trades).toHaveLength(1);
  });

  it("won't offer a swap a pilot has said no to", () => {
    wants(1, 2);
    wants(2, 1);
    expect(findTrades(pack, [pilot(1), pilot(2)], { now, excludeSwap: (id) => id === "P2" }).trades).toEqual([]);
  });

  it("leaves out a trip the pilot has locked", () => {
    wants(1, 2);
    wants(2, 1);
    const locked = { ...pilot(1), locked: new Set(["t1@5"]) };
    expect(findTrades(pack, [locked, pilot(2)], { now }).trades).toEqual([]);
  });

  it("leaves out a trade that would conflict with what the pilot keeps", () => {
    wants(1, 2);
    wants(2, 1);
    const p1 = pilot(1);
    p1.line = { ...p1.line, trips: [trip("t1", 2), trip("keep", 10)] };
    const p2 = pilot(2, 10); // same dates as the trip P1 is keeping
    gains.table.set("L1:t1>t2", 3);
    gains.table.set("L2:t2>t1", 3);
    expect(findTrades(pack, [p1, p2], { now }).trades).toEqual([]);
  });

  it("drops a chain with no legal order, even though everyone's final schedule works", () => {
    // Each pilot keeps a second trip that collides with one trip in the chain, ruling out every order's middle step.
    for (let i = 1; i <= 3; i++) wants(i, (i % 3) + 1);
    const with2nd = (n: number, blockedDay: number) => {
      const p = pilot(n, n * 3);
      p.line = { ...p.line, trips: [trip(`t${n}`, n * 3), trip(`k${n}`, blockedDay)] };
      return p;
    };
    // P1 ends with t2 (day 6) and keeps day 15; P2 ends with t3 (day 9) and keeps day 3 (t1's date: can't pass through); P3 ends with t1 (day 3) and keeps day 6 (t2's date).
    const { options } = findTrades(pack, [with2nd(1, 9), with2nd(2, 3), with2nd(3, 6)], { now });
    expect(options).toEqual([]);
  });
});
