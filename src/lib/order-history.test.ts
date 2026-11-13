import { describe, expect, it } from "vitest";
import { EMPTY_ORDER_HISTORY, dropSwaps, recordStep, takeRedo, takeUndo, type OrderHistory } from "./order-history";

type Swap = { id: string; lesson?: string[] };
const tier = { kind: "tier" } as const;
const swap = (id: string, lesson?: string[]) => ({ kind: "swap", swap: { id, lesson } }) as const;

describe("one undo history for tiers and swaps", () => {
  it("takes back the newest step first, whichever kind it was", () => {
    let h: OrderHistory<Swap> = EMPTY_ORDER_HISTORY;
    h = recordStep(h, tier);
    h = recordStep(h, swap("s1"));
    const first = takeUndo(h)!;
    // The swap made after the tier move goes first, not the older tier move.
    expect(first.step).toEqual(swap("s1"));
    const second = takeUndo(first.history)!;
    expect(second.step).toEqual(tier);
    expect(takeUndo(second.history)).toBeNull();
  });

  it("redoes in the order undone, with what the undo kept for it", () => {
    let h: OrderHistory<Swap> = recordStep(recordStep(EMPTY_ORDER_HISTORY, swap("s1")), tier);
    h = takeUndo(h)!.history;
    h = takeUndo(h, (s) => (s.kind === "swap" ? swap(s.swap.id, ["taught"]) : s))!.history;
    const r1 = takeRedo(h)!;
    expect(r1.step).toEqual(swap("s1", ["taught"]));
    const r2 = takeRedo(r1.history)!;
    expect(r2.step).toEqual(tier);
    expect(takeRedo(r2.history)).toBeNull();
    expect(r2.history.past).toHaveLength(2);
  });

  it("forgets what's to redo once something new is done", () => {
    const h = takeUndo(recordStep(EMPTY_ORDER_HISTORY as OrderHistory<Swap>, tier))!.history;
    expect(h.future).toHaveLength(1);
    expect(recordStep(h, swap("s2")).future).toEqual([]);
  });

  it("drops a swap taken back some other way from both sides", () => {
    let h: OrderHistory<Swap> = recordStep(recordStep(recordStep(EMPTY_ORDER_HISTORY, swap("s1")), tier), swap("s2"));
    h = takeUndo(h)!.history;
    h = dropSwaps(h, (s) => s.id === "s2" || s.id === "s1");
    expect(h).toEqual({ past: [tier], future: [] });
  });
});
