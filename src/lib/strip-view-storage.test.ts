import { describe, expect, it } from "vitest";
import { buildLineTimeline } from "@/lib/line-timeline";
import { stripViewFor } from "@/lib/strip-view-storage";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

describe("the strip a pack can draw", () => {
  it("is the pilot's choice on a pack with bid period dates", () => {
    expect(stripViewFor("timeline", { bidPeriodStart: "2026-11-01" })).toBe("timeline");
    expect(stripViewFor("pack", { bidPeriodStart: "2026-11-01" })).toBe("pack");
  });

  it("is the Bid pack row on a pack without them, where the timeline has nothing to draw", () => {
    expect(stripViewFor("timeline", { bidPeriodStart: null })).toBe("pack");
    // The sample pack is one: its timeline comes out empty for every line.
    expect(SAMPLE_BID_PACK.bidPeriodStart).toBeNull();
    const line = SAMPLE_BID_PACK.lines.find((l) => l.trips.length > 0)!;
    expect(buildLineTimeline(line, SAMPLE_BID_PACK, 35).trips).toEqual([]);
    expect(stripViewFor("timeline", SAMPLE_BID_PACK)).toBe("pack");
  });
});
