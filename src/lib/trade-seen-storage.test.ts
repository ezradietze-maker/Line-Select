import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSeenOfferIds, newArrivals, saveSeenOfferIds } from "@/lib/trade-seen-storage";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("offers seen in the Inbox", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
  });

  it("are kept per pilot, so a reload doesn't count them again", () => {
    saveSeenOfferIds("pilot-1", new Set(["a", "b"]));
    expect([...loadSeenOfferIds("pilot-1")]).toEqual(["a", "b"]);
    expect(loadSeenOfferIds("pilot-2").size).toBe(0);
  });

  it("keep the newest few hundred", () => {
    saveSeenOfferIds("pilot-1", new Set(Array.from({ length: 600 }, (_, i) => `o${i}`)));
    const kept = loadSeenOfferIds("pilot-1");
    expect(kept.size).toBe(500);
    expect(kept.has("o599")).toBe(true);
    expect(kept.has("o0")).toBe(false);
  });

  it("come back empty from anything unreadable", () => {
    window.localStorage.setItem("line-select:trade-offers-seen:pilot-1:v1", "{not json");
    expect(loadSeenOfferIds("pilot-1").size).toBe(0);
  });
});

describe("which offers to toast", () => {
  it("takes the first load as the baseline, so the backlog isn't toasted", () => {
    const first = newArrivals(null, "pilot-1|pack", ["a", "b"]);
    expect(first.fresh).toEqual([]);
    const next = newArrivals(first.baseline, "pilot-1|pack", ["a", "b", "c"]);
    expect(next.fresh).toEqual(["c"]);
    expect(newArrivals(next.baseline, "pilot-1|pack", ["a", "b", "c"]).fresh).toEqual([]);
  });

  it("starts again for another pilot or pack", () => {
    const first = newArrivals(null, "pilot-1|pack", ["a"]);
    expect(newArrivals(first.baseline, "pilot-2|pack", ["a", "x", "y"]).fresh).toEqual([]);
    expect(newArrivals(first.baseline, "pilot-1|other", ["z"]).fresh).toEqual([]);
  });
});
