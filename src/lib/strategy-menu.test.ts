import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRATEGY, menuIsOpen, readMenuOpen, STRATEGY_MENU, strategyFromHash } from "@/lib/strategy-menu";
import type { StrategyId } from "@/types/strategy";

// Every strategy the engine can make: listing it here keeps the sidebar from missing one when a new strategy is added.
const ALL_STRATEGIES: Record<StrategyId, true> = {
  "true-number": true,
  leftovers: true,
  "secondary-play": true,
  "reserve-pays-more": true,
  "vacation-overlap": true,
  "carry-over": true,
  "sweep-flights": true,
  "after-award": true,
};

describe("the sidebar's list of strategies", () => {
  it("has the vacation slide tool first, then every strategy, once each", () => {
    const ids = STRATEGY_MENU.map((m) => m.id);
    expect(ids[0]).toBe("vacation");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(1).sort()).toEqual(Object.keys(ALL_STRATEGIES).sort());
  });

  it("names each strategy as its card does", () => {
    const engine = readFileSync(new URL("./strategy-engine.ts", import.meta.url), "utf8");
    for (const item of STRATEGY_MENU.filter((m) => m.id !== "vacation")) {
      expect(engine, item.id).toContain(`name: "${item.name}"`);
    }
  });

  it("keeps the sidebar's labels short enough to read in the rail", () => {
    for (const item of STRATEGY_MENU) expect(item.label.length, item.label).toBeLessThanOrEqual(24);
  });
});

describe("which strategy an address shows", () => {
  it("is the one named after the #", () => {
    expect(strategyFromHash("#leftovers")).toBe("leftovers");
    expect(strategyFromHash("#after-award")).toBe("after-award");
  });

  it("is the vacation slide tool with nothing named, or a name it doesn't know", () => {
    expect(strategyFromHash("")).toBe(DEFAULT_STRATEGY);
    expect(strategyFromHash("#")).toBe(DEFAULT_STRATEGY);
    expect(strategyFromHash("#no-such-move")).toBe(DEFAULT_STRATEGY);
    expect(strategyFromHash("#%E0%A4%A")).toBe(DEFAULT_STRATEGY);
  });
});

describe("whether the sidebar's strategies list is unfolded", () => {
  it("follows the page until the pilot chooses: open on Strategies, folded elsewhere", () => {
    expect(menuIsOpen(null, true)).toBe(true);
    expect(menuIsOpen(null, false)).toBe(false);
  });

  it("keeps the pilot's own choice wherever they are", () => {
    expect(menuIsOpen("open", false)).toBe(true);
    expect(menuIsOpen("closed", true)).toBe(false);
  });

  it("reads only what it stored", () => {
    expect(readMenuOpen("open")).toBe("open");
    expect(readMenuOpen("closed")).toBe("closed");
    expect(readMenuOpen(null)).toBeNull();
    expect(readMenuOpen("yes")).toBeNull();
  });
});
