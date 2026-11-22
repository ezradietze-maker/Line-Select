import { describe, expect, it } from "vitest";
import { HELD_KEPT, applyPlacements, heldPlacement, mergePlacements, placementFromDrag, prunePlacements, releaseHolds, swapOf, withPlacement } from "@/lib/line-placements";

const id = (x: string) => x;

describe("keeping the pilot's swaps where they put them", () => {
  it("swaps the dropped line with the one it lands on, and leaves the lines between alone", () => {
    const shown = ["A", "B", "C", "D"];
    const up = placementFromDrag(shown, 3, 0, "s1")!;
    expect(applyPlacements(shown, [up], id)).toEqual(["D", "B", "C", "A"]);
    const down = placementFromDrag(shown, 1, 2, "s2")!;
    expect(applyPlacements(shown, [down], id)).toEqual(["A", "C", "B", "D"]);
    expect(placementFromDrag(shown, 2, 2, "s3")).toBeNull();
  });

  it("holds the swap when the brain's order changes underneath — including when it has learned the swap itself", () => {
    const swap = placementFromDrag(["A", "B", "C"], 1, 0, "s1")!; // B above A
    // The brain now ranks a new line first and has B ahead of A on its own: nothing to undo, B stays above A.
    expect(applyPlacements(["X", "B", "A", "C"], [swap], id)).toEqual(["X", "B", "A", "C"]);
    // The brain moved the pair apart: they keep the pilot's order in the places they hold.
    expect(applyPlacements(["A", "X", "C", "B"], [swap], id)).toEqual(["B", "X", "C", "A"]);
  });

  it("applies swaps oldest first, so a later one wins", () => {
    const list = ["A", "B", "C"];
    const first = placementFromDrag(list, 2, 0, "s1")!; // C B A
    const second = placementFromDrag(applyPlacements(list, [first], id), 2, 0, "s2")!; // back to A B C
    expect(applyPlacements(list, [first, second], id)).toEqual(["A", "B", "C"]);
  });

  it("drops lines that are gone from the pack, and swaps left with fewer than two", () => {
    const kept = prunePlacements([{ id: "s1", order: ["A", "Z", "B"] }, { id: "s2", order: ["Z", "C"] }], new Set(["A", "B", "C"]));
    expect(kept).toEqual([{ id: "s1", order: ["A", "B"] }]);
  });
});

describe("keeping the rest of the list where it is when the pilot swaps", () => {
  const shown = ["A", "B", "C", "D", "E", "F"];
  // Line 5 (E) dropped on line 1 (A), with the list held.
  const swap = placementFromDrag(shown, 4, 0, "s1")!;
  const held = heldPlacement(shown, swap);

  it("moves only the two lines swapped, however the brain re-ranks the rest after learning", () => {
    expect(applyPlacements(shown, [held], id)).toEqual(["E", "B", "C", "D", "A", "F"]);
    // The refit re-ranked every line: held, nothing moves but the swap.
    const relearned = ["F", "D", "B", "A", "C", "E"];
    expect(applyPlacements(relearned, [held], id)).toEqual(["E", "B", "C", "D", "A", "F"]);
    // Not held, the swap (and the lines between, in the order seen) stays together, but the rest follow the brain: F
    // jumps to the top.
    expect(applyPlacements(relearned, [swap], id)).toEqual(["F", "E", "B", "C", "D", "A"]);
  });

  it("keeps the swap itself apart, for the brain and the 'Your order' tags — never the whole held list", () => {
    expect(swapOf(held)).toEqual(swap.order);
    expect(swapOf(swap)).toEqual(swap.order);
    expect(held.order).toHaveLength(shown.length);
  });

  it("re-sorts with what was taught: the swaps stay, the rest goes where the brain now puts it", () => {
    const relearned = ["F", "D", "B", "A", "C", "E"];
    expect(releaseHolds([held])).toEqual([swap]);
    expect(applyPlacements(relearned, releaseHolds([held]), id)).toEqual(applyPlacements(relearned, [swap], id));
  });

  it("undoing the newest held swap brings back the list as held before it", () => {
    const after1 = applyPlacements(shown, [held], id);
    const second = heldPlacement(after1, placementFromDrag(after1, 2, 1, "s2")!);
    const relearned = ["F", "D", "B", "A", "C", "E"];
    expect(applyPlacements(relearned, [held, second], id)).toEqual(["E", "C", "B", "D", "A", "F"]);
    expect(applyPlacements(relearned, [held], id)).toEqual(after1);
  });

  it("holds lines the list gains or loses: a line gone is dropped, a new one keeps the brain's place", () => {
    expect(prunePlacements([held], new Set(["A", "B", "C", "D", "E"]))).toEqual([{ id: "s1", order: ["E", "B", "C", "D", "A"], swapped: ["E", "B", "C", "D", "A"] }]);
    // A swap with fewer than two of its own lines left goes, held list and all.
    expect(prunePlacements([held], new Set(["A", "F"]))).toEqual([]);
    expect(applyPlacements(["G", ...shown], [held], id)).toEqual(["G", "E", "B", "C", "D", "A", "F"]);
  });

  it("keeps every line only on the newest held swaps, so what's stored stays small", () => {
    let all: ReturnType<typeof withPlacement> = [];
    for (let k = 0; k < HELD_KEPT + 3; k++) all = withPlacement(all, heldPlacement(shown, { id: `s${k}`, order: ["A", "B"] }));
    expect(all).toHaveLength(HELD_KEPT + 3);
    expect(all.filter((p) => p.swapped)).toHaveLength(HELD_KEPT);
    expect(all.slice(0, 3).every((p) => !p.swapped && p.order.length === 2)).toBe(true);
  });

  it("merges two tabs' held swaps like any others", () => {
    const other = heldPlacement(shown, placementFromDrag(shown, 3, 2, "s9")!);
    expect(mergePlacements([], [held], [other])).toEqual([other, held]);
  });
});
