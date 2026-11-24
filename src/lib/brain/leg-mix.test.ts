import { describe, expect, it } from "vitest";
import { legMixText } from "@/lib/brain/leg-mix";
import type { TripFacts } from "@/lib/metrics/trip-facts";

/** A trip's facts with just its duties' operated leg counts — all `legMixText` reads. */
const trip = (...legs: number[]) => ({ duties: legs.map((operatedLegs) => ({ operatedLegs })) }) as unknown as TripFacts;

describe("legMixText", () => {
  it("says a line of one-leg duties as all single-leg", () => {
    expect(legMixText([trip(1, 1), trip(1, 0, 1)])).toBe("all single-leg duty periods");
    expect(legMixText([trip(1)])).toBe("1 single-leg duty period");
  });
  it("counts duties by their legs, never as extra legs", () => {
    expect(legMixText([trip(1, 2), trip(2, 1, 1)])).toBe("2 two-leg duty periods, the rest single-leg");
    expect(legMixText([trip(1, 2, 3)])).toBe("1 two-leg duty period and 1 three-leg duty period, 1 single-leg");
    expect(legMixText([trip(3, 3)])).toBe("2 three-leg duty periods");
    expect(legMixText([trip(2, 3, 4, 1, 1)])).toBe("1 two-leg duty period, 1 three-leg duty period and 1 four-leg duty period, the rest single-leg");
  });
  it("leaves out duties with no flying, and has nothing to say without any", () => {
    expect(legMixText([trip(0, 0)])).toBeNull();
  });
});
