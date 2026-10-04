import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBidDeadline, setBidDeadline } from "@/lib/bid-deadline-storage";

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
    vi.stubGlobal("window", { localStorage: memoryStorage() });
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
});
