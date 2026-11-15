import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LineScore } from "@/lib/scoring";
import type { LineTiers } from "@/lib/use-line-tiers";

/**
 * The results list's selection as the list shows it (`useTiersWithin`), run for real on a stand-in for the page (it
 * draws nothing of its own): the tiers hook, and the lines a search lists around it. The device's storage is a stand-in.
 */
const store = vi.hoisted(() => new Map<string, string>());
const doc = vi.hoisted(() => ({ nodeType: 9, activeElement: null, body: {}, addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, style: {} }) }));
vi.stubGlobal("window", {
  document: doc,
  HTMLIFrameElement: class {},
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.stubGlobal("document", doc);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const { createRoot } = await import("react-dom/client");
const { useLineTiers, useTiersWithin } = await import("@/lib/use-line-tiers");

const IDS = ["a", "b", "c", "d", "e"];
const RANKED = IDS.map((id) => ({ line: { id, lineNumber: id } }) as unknown as LineScore);
const ALL: ReadonlySet<string> = new Set(IDS);
const teach = { current: null };

/** The tiers as the list shows them, with the lines `listed()` says it lists; `tiers()` is what the list reads now. */
async function mount(listed: () => ReadonlySet<string>): Promise<{ tiers: () => LineTiers; rerender: () => Promise<void> }> {
  let now: LineTiers | null = null;
  function List({ ids }: { ids: ReadonlySet<string> }) {
    now = useTiersWithin(useLineTiers("u", "pack", IDS, RANKED, teach), ids);
    return null;
  }
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: doc, addEventListener() {}, removeEventListener() {} };
  const root = createRoot(container as unknown as HTMLElement);
  const rerender = () => act(async () => root.render(<List ids={listed()} />));
  await rerender();
  return { tiers: () => now!, rerender };
}

describe("the results list's selection", () => {
  it("gives back the lines a search hid, still selected, once the search is cleared", async () => {
    let listed = ALL;
    const list = await mount(() => listed);
    await act(async () => list.tiers().select(["b", "c", "d"]));
    // A search for one more line to add lists only it and c.
    listed = new Set(["c", "e"]);
    await list.rerender();
    expect([...list.tiers().selected]).toEqual(["c"]);
    await act(async () => list.tiers().toggleSelected("e"));
    expect([...list.tiers().selected].sort()).toEqual(["c", "e"]);
    // Cleared: taken out of the selection, b and d were gone, and a move took c and e alone.
    listed = ALL;
    await list.rerender();
    expect([...list.tiers().selected].sort()).toEqual(["b", "c", "d", "e"]);
  });

  it("moves only the selected lines the list shows", async () => {
    let listed = ALL;
    const list = await mount(() => listed);
    await act(async () => list.tiers().select(["b", "c", "d"]));
    listed = new Set(["a", "c"]);
    await list.rerender();
    await act(async () => list.tiers().move([...list.tiers().selected], "not-bid"));
    expect(Object.keys(list.tiers().state.assigned)).toEqual(["c"]);
  });
});
