import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAIL_KEY } from "@/lib/rail-key";
import { railFoldKept, setRailCollapsed } from "@/lib/rail";

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
}

describe("the sidebar's fold", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { documentElement: fakeRoot() });
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("window", { dispatchEvent: () => true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is kept for the next visit when the pilot folds it", () => {
    setRailCollapsed(true);
    expect(document.documentElement.getAttribute("data-rail")).toBe("collapsed");
    expect(localStorage.getItem(RAIL_KEY)).toBe("collapsed");
    expect(railFoldKept()).toBe(true);
  });

  it("is not kept when the Timeline folds it for room", () => {
    // Kept, a reload on the Timeline (the default view) left the sidebar folded on every page after, and on the Bid pack
    // view too: the Timeline only unfolds a sidebar it folded itself.
    setRailCollapsed(true, { keep: false });
    expect(document.documentElement.getAttribute("data-rail")).toBe("collapsed");
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    expect(railFoldKept()).toBe(false);
    setRailCollapsed(false, { keep: false });
    expect(document.documentElement.getAttribute("data-rail")).toBeNull();
  });

  it("opened by the pilot, forgets their fold", () => {
    setRailCollapsed(true);
    setRailCollapsed(false);
    expect(localStorage.getItem(RAIL_KEY)).toBeNull();
    expect(railFoldKept()).toBe(false);
  });
});
