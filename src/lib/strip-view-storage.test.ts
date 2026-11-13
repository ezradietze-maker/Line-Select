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
    const undated = { ...SAMPLE_BID_PACK, bidPeriodStart: null };
    const line = undated.lines.find((l) => l.trips.length > 0)!;
    expect(buildLineTimeline(line, undated, 35).trips).toEqual([]);
    expect(stripViewFor("timeline", undated)).toBe("pack");
  });

  it("is the pilot's choice on the sample pack too, which is on dates like an uploaded one", () => {
    const line = SAMPLE_BID_PACK.lines.find((l) => l.trips.length > 0)!;
    expect(buildLineTimeline(line, SAMPLE_BID_PACK, 35).trips).toHaveLength(line.trips.length);
    expect(stripViewFor("timeline", SAMPLE_BID_PACK)).toBe("timeline");
  });
});
