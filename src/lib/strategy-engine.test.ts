import { describe, expect, it } from "vitest";
import { buildAutoBid, estimateFeasibility, generateStrategies } from "@/lib/strategy-engine";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { SeniorityInput } from "@/types/strategy";

const SENIOR: SeniorityInput = { rank: 1, totalPilots: 200 };
const JUNIOR: SeniorityInput = { rank: 199, totalPilots: 200 };

describe("generateStrategies", () => {
  it("returns all five strategies without throwing, each with real (non-empty) explanatory text", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    expect(strategies).toHaveLength(5);
    for (const s of strategies) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.mechanism.length).toBeGreaterThan(0);
      expect(s.benefits.length).toBeGreaterThan(0);
    }
  });

  it("always finds a Safety Net candidate, since every real bid pack has *some* line to fall back on", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const safetyNet = strategies.find((s) => s.id === "safety-net");
    expect(safetyNet?.lines.length).toBeGreaterThan(0);
  });

  it("never claims a Ghost Line pattern unless real flying is genuinely under half the paid day-rig rate", () => {
    // The sample pack's trips were hand-built for circadian-science testing,
    // not day-rig testing, so none of them are honestly "mostly standby" —
    // this line stays empty rather than crowning whichever of the six is
    // merely the least-bad option (the bug this test guards against).
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const ghost = strategies.find((s) => s.id === "ghost-line")!;
    for (const rec of ghost.lines) {
      const line = SAMPLE_BID_PACK.lines.find((l) => l.lineNumber === rec.lineNumber)!;
      const dayRigHoursPerDay = line.totalCreditHours / (line.totalTafbHours / 24);
      // headline reads "<credit> credit hours from just <block> hours of real flying"
      const block = Number(rec.headline.match(/just ([\d.]+) hours/)?.[1]);
      expect(block).toBeLessThanOrEqual(dayRigHoursPerDay * 0.5 * (line.totalTafbHours / 24));
    }
  });

  it("never recommends a line number that doesn't exist in the bid pack", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const realLineNumbers = new Set(SAMPLE_BID_PACK.lines.map((l) => l.lineNumber));
    for (const s of strategies) {
      for (const rec of s.lines) {
        expect(realLineNumbers.has(rec.lineNumber)).toBe(true);
      }
    }
  });

  it("gives the most senior pilot at least as good a feasibility tier as the most junior on the same top pick", () => {
    const seniorStrategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const juniorStrategies = generateStrategies(SAMPLE_BID_PACK, JUNIOR);
    const tierRank = { strong: 2, possible: 1, longshot: 0 };

    for (const seniorStrategy of seniorStrategies) {
      const juniorStrategy = juniorStrategies.find((s) => s.id === seniorStrategy.id)!;
      for (let i = 0; i < seniorStrategy.lines.length; i++) {
        const seniorTier = tierRank[seniorStrategy.lines[i].feasibility];
        const juniorTier = tierRank[juniorStrategy.lines[i].feasibility];
        expect(seniorTier).toBeGreaterThanOrEqual(juniorTier);
      }
    }
  });

  it("the process-tip strategy carries no fabricated line recommendations", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const reBid = strategies.find((s) => s.id === "re-bid-chain");
    expect(reBid?.isProcessTip).toBe(true);
    expect(reBid?.lines).toHaveLength(0);
  });
});

describe("estimateFeasibility", () => {
  it("calls it strong when seniority percentile meets or beats the line's desirability percentile", () => {
    expect(estimateFeasibility(0.9, 0.95).tier).toBe("strong");
    expect(estimateFeasibility(0.5, 0.5).tier).toBe("strong");
  });

  it("calls it a longshot when seniority falls well short of how rare the pattern is", () => {
    expect(estimateFeasibility(0.95, 0.2).tier).toBe("longshot");
  });
});

describe("buildAutoBid", () => {
  it("produces a sequentially ranked list with no duplicate line numbers", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const autoBid = buildAutoBid(strategies);
    expect(autoBid.length).toBeGreaterThan(0);
    const lineNumbers = autoBid.map((e) => e.lineNumber);
    expect(new Set(lineNumbers).size).toBe(lineNumbers.length);
    autoBid.forEach((entry, i) => expect(entry.rank).toBe(i + 1));
  });
});
