import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** One device's storage shared by two tabs, each its own copy of the module (as each tab loads its own). */
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

async function tab() {
  vi.resetModules();
  return import("@/lib/start-over-signal");
}

describe("Start over heard in another tab", () => {
  beforeEach(() => vi.stubGlobal("window", { localStorage: fakeStorage() }));
  afterEach(() => vi.unstubAllGlobals());

  it("leaves a tab still holding the deleted work unable to save it, until it has dropped it", async () => {
    const b = await tab();
    const a = await tab();
    a.announceStartOver("pilot-1");
    expect(a.staleAfterStartOver("pilot-1")).toBe(false);
    expect(b.staleAfterStartOver("pilot-1")).toBe(true);
    b.caughtUpWithStartOver();
    expect(b.staleAfterStartOver("pilot-1")).toBe(false);
  });

  it("is only the pilot's whose work was deleted", async () => {
    const b = await tab();
    const a = await tab();
    a.announceStartOver("pilot-1");
    expect(b.staleAfterStartOver("pilot-2")).toBe(false);
    expect(b.staleAfterStartOver(null)).toBe(false);
  });

  it("is nothing to a tab opened after it", async () => {
    const a = await tab();
    a.announceStartOver(null);
    const c = await tab();
    expect(c.staleAfterStartOver(null)).toBe(false);
  });
});
