import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bidPackSavedAt, clearBidPack, compactBidPack, expandBidPack, loadBidPack, restoreBidPack, saveBidPack } from "@/lib/bidpack-storage";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { BidPack, Trip } from "@/types/bidpack";

/** About what a browser allows a site, in characters. */
const QUOTA = 5_242_880;
const GUEST_KEY = "line-select:bidpack:guest:v1";

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

const stored = () => (window as unknown as { localStorage: ReturnType<typeof memoryStorage> }).localStorage.map;

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
    vi.unstubAllGlobals();
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("round-trips a pack exactly, including each line's own trip start days", async () => {
    const pack = busyPack();
    expect(await saveBidPack(null, pack)).toBe(true);
    const loaded = (await loadBidPack(null))!;
    expect(loaded.lines.map((l) => l.trips.map((t) => t.startDayIndex))).toEqual(pack.lines.map((l) => l.trips.map((t) => t.startDayIndex)));
    expect(loaded.lines[3].trips[0].schedule[0].legs[0].depTimeZulu).toBe(pack.lines[3].trips[0].schedule[0].legs[0].depTimeZulu);
    expect(loaded.lines[3].trips[0].id).toBe(pack.lines[3].trips[0].id);
  });

  it("writes each distinct trip once, so a pack repeating the same trips across lines stays small", () => {
    const pack = busyPack();
    const json = JSON.stringify(compactBidPack(pack));
    expect(json.length).toBeLessThan(JSON.stringify(pack).length / 3);
    expect(Object.keys(compactBidPack(pack).tripTable)).toHaveLength(1);
  });

  it("leaves out timestamps it can rebuild, and rebuilds them exactly", async () => {
    const pack = busyPack();
    expect(JSON.stringify(compactBidPack(pack))).not.toContain("depTimeZulu");
    expandBidPack(JSON.parse(JSON.stringify(compactBidPack(pack))));
    await saveBidPack(null, pack);
    const reloaded = (await loadBidPack(null))!;
    for (const leg of reloaded.lines[0].trips[0].schedule.flatMap((d) => d.legs)) {
      expect(leg.depTimeZulu).toBeTruthy();
      expect(leg.arrTimeZulu).toBeTruthy();
    }
  });

  it("keeps two different trips that share an id rather than merging them", async () => {
    const pack = busyPack();
    const odd: Trip = { ...pack.lines[1].trips[0], creditHours: 99 };
    pack.lines[1] = { ...pack.lines[1], trips: [odd] };
    await saveBidPack(null, pack);
    const loaded = (await loadBidPack(null))!;
    expect(loaded.lines[1].trips[0].creditHours).toBe(99);
    expect(loaded.lines[0].trips[0].creditHours).toBe(pack.lines[0].trips[0].creditHours);
  });

  it("writes the pack gzipped, in plain ASCII, a fraction of its compact size", async () => {
    const pack = busyPack();
    await saveBidPack(null, pack);
    const text = stored().get(GUEST_KEY)!;
    expect(text.startsWith("gz1:")).toBe(true);
    expect(/^[\x20-\x7e]*$/.test(text)).toBe(true);
    expect(text.length).toBeLessThan(JSON.stringify(compactBidPack(pack)).length / 3);
  });

  it("still reads a pack saved in the old, uncompacted format, and rewrites it gzipped without re-stamping it", async () => {
    const pack = busyPack();
    stored().set(GUEST_KEY, JSON.stringify(pack));
    stored().set(`${GUEST_KEY}:saved-at`, "1000");
    expect((await loadBidPack(null))!.lines).toHaveLength(30);
    expect(stored().get(GUEST_KEY)!.startsWith("gz1:")).toBe(true);
    expect(bidPackSavedAt(null)).toBe(1000);
    expect((await loadBidPack(null))!.lines).toHaveLength(30);
  });

  it("still reads a pack saved compact but not gzipped (as every pack was until Nov 2026), and rewrites it gzipped", async () => {
    const pack = busyPack();
    stored().set(GUEST_KEY, JSON.stringify(compactBidPack(pack)));
    const loaded = (await loadBidPack(null))!;
    expect(loaded.lines.map((l) => l.trips.map((t) => t.startDayIndex))).toEqual(pack.lines.map((l) => l.trips.map((t) => t.startDayIndex)));
    expect(stored().get(GUEST_KEY)!.startsWith("gz1:")).toBe(true);
  });

  it("an old pack the browser won't take back gzipped still loads, from the copy already there", async () => {
    const old = JSON.stringify(compactBidPack(busyPack()));
    const store = memoryStorage();
    store.map.set(GUEST_KEY, old);
    store.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    vi.stubGlobal("window", { localStorage: store });
    expect((await loadBidPack(null))!.lines).toHaveLength(30);
    expect(store.map.get(GUEST_KEY)).toBe(old);
  });

  it("keeps plain JSON where the browser has no gzip, and reads it back", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const pack = busyPack();
    expect(await saveBidPack(null, pack)).toBe(true);
    expect(stored().get(GUEST_KEY)!.startsWith("{")).toBe(true);
    expect((await loadBidPack(null))!.lines).toHaveLength(30);
    expect(stored().get(GUEST_KEY)!.startsWith("{")).toBe(true);
  });

  it("says so when the browser won't take the pack, instead of failing silently", async () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(100) });
    expect(await saveBidPack(null, busyPack())).toBe(false);
  });

  it("keeps the pack saved last when two saves overlap", async () => {
    const first = busyPack();
    const second = { ...busyPack(), lines: busyPack().lines.slice(0, 7) };
    const a = saveBidPack(null, first);
    const b = saveBidPack(null, second);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect((await loadBidPack(null))!.lines).toHaveLength(7);
  });

  it("doesn't bring a pack back that was cleared while it was still being written", async () => {
    const saving = saveBidPack(null, busyPack());
    clearBidPack(null);
    await saving;
    expect(stored().has(GUEST_KEY)).toBe(false);
    expect(await loadBidPack(null)).toBeNull();
    // A save asked for after the clear is kept as usual.
    await saveBidPack(null, busyPack());
    expect((await loadBidPack(null))!.lines).toHaveLength(30);
  });

  // The biggest real pack, when this checkout has the cached packs (they're not in the repository).
  const BIG = ".cache/packs/OCT26-MEM-B777-FO.json";
  it.skipIf(!existsSync(BIG))("keeps the biggest real pack in a small share of the browser's room, exactly as it was", async () => {
    const compact = readFileSync(BIG, "utf8");
    const pack = restoreBidPack(JSON.parse(compact));
    expect(await saveBidPack("pilot", pack)).toBe(true);
    const text = stored().get("line-select:bidpack:pilot:v1")!;
    expect(text.length).toBeLessThan(QUOTA * 0.2);
    expect(text.length).toBeLessThan(compact.length / 4);
    expect(JSON.stringify(await loadBidPack("pilot"))).toBe(JSON.stringify(pack));
  });
});
