import { beforeEach, describe, expect, it, vi } from "vitest";
import { compactBidPack, expandBidPack, loadBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack, Trip } from "@/types/bidpack";

function memoryStorage(limit = Infinity) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException("quota", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

/** A pack where the same trip appears in many lines at different start days, as in a real one. */
function busyPack(): BidPack {
  const trip = SAMPLE_BID_PACK.lines.flatMap((l) => l.trips).find((t) => t.schedule.length > 0)!;
  const lines = Array.from({ length: 30 }, (_, i) => ({
    ...SAMPLE_BID_PACK.lines[0],
    id: `line-${i}`,
    lineNumber: String(1000 + i),
    trips: [{ ...trip, startDayIndex: i % 20 }, { ...trip, startDayIndex: (i % 20) + 5 }],
  }));
  return { ...SAMPLE_BID_PACK, lines };
}

describe("bid pack storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("round-trips a pack exactly, including each line's own trip start days", () => {
    const pack = busyPack();
    expect(saveBidPack(null, pack)).toBe(true);
    const loaded = loadBidPack(null)!;
    expect(loaded.lines.map((l) => l.trips.map((t) => t.startDayIndex))).toEqual(pack.lines.map((l) => l.trips.map((t) => t.startDayIndex)));
    expect(loaded.lines[3].trips[0].schedule[0].legs[0].depTimeZulu).toBe(pack.lines[3].trips[0].schedule[0].legs[0].depTimeZulu);
    expect(loaded.lines[3].trips[0].id).toBe(pack.lines[3].trips[0].id);
  });

  it("writes each distinct trip once, so a pack repeating the same trips across lines stays small", () => {
    const pack = busyPack();
    const stored = JSON.stringify(compactBidPack(pack));
    expect(stored.length).toBeLessThan(JSON.stringify(pack).length / 3);
    expect(Object.keys(compactBidPack(pack).tripTable)).toHaveLength(1);
  });

  it("leaves out timestamps it can rebuild, and rebuilds them exactly", () => {
    const pack = busyPack();
    expect(JSON.stringify(compactBidPack(pack))).not.toContain("depTimeZulu");
    const loaded = expandBidPack(JSON.parse(JSON.stringify(compactBidPack(pack))));
    void loaded;
    const reloaded = (saveBidPack(null, pack), loadBidPack(null)!);
    for (const leg of reloaded.lines[0].trips[0].schedule.flatMap((d) => d.legs)) {
      expect(leg.depTimeZulu).toBeTruthy();
      expect(leg.arrTimeZulu).toBeTruthy();
    }
  });

  it("keeps two different trips that share an id rather than merging them", () => {
    const pack = busyPack();
    const odd: Trip = { ...pack.lines[1].trips[0], creditHours: 99 };
    pack.lines[1] = { ...pack.lines[1], trips: [odd] };
    saveBidPack(null, pack);
    const loaded = loadBidPack(null)!;
    expect(loaded.lines[1].trips[0].creditHours).toBe(99);
    expect(loaded.lines[0].trips[0].creditHours).toBe(pack.lines[0].trips[0].creditHours);
  });

  it("still reads a pack saved in the old, uncompacted format", () => {
    const pack = busyPack();
    (window as unknown as { localStorage: ReturnType<typeof memoryStorage> }).localStorage.setItem("line-select:bidpack:guest:v1", JSON.stringify(pack));
    expect(loadBidPack(null)!.lines).toHaveLength(30);
  });

  it("says so when the browser won't take the pack, instead of failing silently", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(100) });
    expect(saveBidPack(null, busyPack())).toBe(false);
  });
});
