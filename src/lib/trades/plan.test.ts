import { describe, expect, it } from "vitest";
import { planChain } from "@/lib/trades/plan";

const anything = () => true;

/** Plays the plan's trades out and returns what each position ends up holding. */
function playOut(size: number, steps: { a: number; b: number }[]): number[] {
  const holds = Array.from({ length: size }, (_, i) => i);
  for (const { a, b } of steps) [holds[a], holds[b]] = [holds[b], holds[a]];
  return holds;
}

describe("the order of a chain's trades", () => {
  it("takes one trade for two pilots", () => {
    const plan = planChain(2, anything)!;
    expect(plan.steps).toEqual([{ a: 0, b: 1 }]);
    expect(plan.exposure).toBe(0);
  });

  it.each([3, 4, 5])("takes %i pilots to where they want to be in one fewer trades", (size) => {
    const plan = planChain(size, anything)!;
    expect(plan.steps).toHaveLength(size - 1);
    expect(playOut(size, plan.steps)).toEqual(Array.from({ length: size }, (_, i) => (i + 1) % size));
  });

  it("goes around an order where a pilot would hold a trip that conflicts with their schedule", () => {
    // Position 1 can't hold trip 0, even for a moment, so positions 0 and 1 can't trade first.
    const plan = planChain(3, (pilot, trip) => !(pilot === 1 && trip === 0))!;
    expect(plan.steps).toHaveLength(2);
    expect(playOut(3, plan.steps)).toEqual([1, 2, 0]);
    let holds = [0, 1, 2];
    for (const { a, b } of plan.steps) {
      holds = [...holds];
      [holds[a], holds[b]] = [holds[b], holds[a]];
      expect(holds[1]).not.toBe(0);
    }
  });

  it("gives up on a chain when no order is legal throughout", () => {
    // Trip 0 has to reach position 2 through someone, and neither other route is open.
    expect(planChain(3, (pilot, trip) => trip === pilot || trip === (pilot + 1) % 3 ? false : true)).toBeNull();
  });

  it("prefers the order that leaves the fewest pilots holding a trip they don't want", () => {
    const plan = planChain(4, anything)!;
    expect(plan.exposure).toBeLessThanOrEqual(2);
  });
});
