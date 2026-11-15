import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TierBar } from "./TierBar";
import { DEFAULT_TIERS } from "@/lib/line-tiers";
import type { LineTiers } from "@/lib/use-line-tiers";

const noop = () => {};
const tiers = {
  state: { tiers: DEFAULT_TIERS, assigned: {}, setAside: ["l-2295"] },
  selected: new Set<string>(),
  notBid: new Set<string>(),
  inUse: false,
  said: "",
  move: noop,
  park: noop,
  unpark: noop,
  toggleSelected: noop,
  clearSelected: noop,
} as unknown as LineTiers;

const bar = (canUndo: boolean, canRedo: boolean) =>
  renderToStaticMarkup(createElement(TierBar, { tiers, lines: [], history: { undo: noop, redo: noop, canUndo, canRedo } }));

describe("TierBar", () => {
  it("dims Undo and Redo when there's nothing to take back, but keeps them where the keyboard is", () => {
    // Disabled, the last Undo pressed let go of focus and the keyboard fell to the top of the page.
    const html = bar(false, false);
    expect(html).toMatch(/<button type="button" data-order-undo="true" aria-disabled="true"[^>]*>Undo<\/button>/);
    expect(html).toMatch(/<button type="button" aria-disabled="true"[^>]*>Redo<\/button>/);
    expect(html).not.toMatch(/disabled=""[^>]*>(Undo|Redo)</);
    expect(bar(true, false)).toMatch(/aria-disabled="false"[^>]*>Undo</);
  });

  it("marks each set-aside chip with its line, for focus to go to the next one when one is brought back", () => {
    expect(bar(false, false)).toMatch(/data-set-aside-chip="l-2295"[^>]*aria-label="Bring line l-2295 back to the list"/);
  });
});
