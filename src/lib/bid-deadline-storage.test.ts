import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBidDeadline, setBidDeadline, subscribeBidDeadline } from "@/lib/bid-deadline-storage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("bid deadline storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { localStorage: memoryStorage() }));
  });

  it("is null until a pilot sets one", () => {
    expect(getBidDeadline("pack-1")).toBeNull();
  });

  it("round-trips exactly what was set, per bid pack", () => {
    setBidDeadline("pack-1", "2026-10-10T17:00:00.000Z");
    expect(getBidDeadline("pack-1")).toBe("2026-10-10T17:00:00.000Z");
    expect(getBidDeadline("pack-2")).toBeNull();
  });

  it("clears with null rather than leaving a stale value", () => {
    setBidDeadline("pack-1", "2026-10-10T17:00:00.000Z");
    setBidDeadline("pack-1", null);
    expect(getBidDeadline("pack-1")).toBeNull();
  });

  it("tells whoever is watching when one is set or cleared, so the calendar link follows", () => {
    const heard = vi.fn();
    const stop = subscribeBidDeadline(heard);
    setBidDeadline("pack-1", "2026-10-10T17:00:00.000Z");
    setBidDeadline("pack-1", null);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setBidDeadline("pack-1", "2026-10-11T17:00:00.000Z");
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
