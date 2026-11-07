import { describe, expect, it } from "vitest";
import { measureAll, prepareMetrics } from "@/lib/metrics/compute";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

describe("measuring a pack once", () => {
  it("keeps each measure's values for the same parameters, and starts afresh when flights arrive", () => {
    const pack = prepareMetrics(SAMPLE_BID_PACK);
    const first = measureAll("daysOff", SAMPLE_BID_PACK.lines, pack);
    expect(measureAll("daysOff", SAMPLE_BID_PACK.lines, pack)).toBe(first);
    expect(measureAll("daysOff", SAMPLE_BID_PACK.lines, pack, { homeAirports: ["SAN"] })).not.toBe(first);
    pack.ctx.flights = {} as typeof pack.ctx.flights;
    const after = measureAll("daysOff", SAMPLE_BID_PACK.lines, pack);
    expect(after).not.toBe(first);
    expect(after).toEqual(first);
  });
});
