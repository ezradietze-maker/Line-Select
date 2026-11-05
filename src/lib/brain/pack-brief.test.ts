import { describe, expect, it } from "vitest";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { METRICS } from "@/lib/metrics/catalog";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

describe("buildPackBrief", () => {
  const brief = buildPackBrief(SAMPLE_BID_PACK);

  it("offers the interview every measure still in use", () => {
    for (const def of METRICS.filter((d) => !d.retired)) expect(brief).toContain(`- ${def.id} [`);
  });

  it("no longer offers a retired one — commutes counted trip by trip read 10 on a line flown with 5", () => {
    expect(brief).not.toContain("baseCommutesNeeded");
    expect(brief).toContain("- departureCommutes [");
  });
});
