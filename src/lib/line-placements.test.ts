import { describe, expect, it } from "vitest";
import { applyPlacements, placementFromDrag, prunePlacements } from "@/lib/line-placements";

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
