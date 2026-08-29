import { describe, expect, it } from "vitest";
import { emptyWeights } from "@/lib/preference-logic";
import {
  buildAutoBid,
  estimateFeasibility,
  generateStrategies,
  rankStrategiesByPreference,
} from "@/lib/strategy-engine";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { SeniorityInput } from "@/types/strategy";

const SENIOR: SeniorityInput = { rank: 1, totalPilots: 200 };
const JUNIOR: SeniorityInput = { rank: 199, totalPilots: 200 };

describe("generateStrategies", () => {
  it("returns every non-reserve strategy without throwing, each with real (non-empty) explanatory text", () => {
    // Reserve Ladder is the one archetype that only appears when the bid
    // pack's own Reserve Lines grid was parsed — SAMPLE_BID_PACK has none,
    // so it should be honestly absent rather than forced.
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    expect(strategies.map((s) => s.id)).not.toContain("reserve-ladder");
    expect(strategies).toHaveLength(6);
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

  it("always includes the Vacation Vault as a generic, line-free tip that never claims to read anyone's actual vacation slot", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const vault = strategies.find((s) => s.id === "vacation-vault");
    expect(vault?.isProcessTip).toBe(true);
    expect(vault?.lines).toHaveLength(0);
  });

  it("includes the Reserve Ladder with an accurate type breakdown once the bid pack's own Reserve Lines grid is present", () => {
    const bidPackWithReserve = {
      ...SAMPLE_BID_PACK,
      reserveLines: [
        { lineNumber: "7001", reserveType: "24hr" as const },
        { lineNumber: "7002", reserveType: "24hr" as const },
        { lineNumber: "7006", reserveType: "a" as const },
        { lineNumber: "7022", reserveType: "b" as const },
        { lineNumber: "7099", reserveType: null },
      ],
      info: {
        rlgHours: 75.75,
        rDayValueHours: 5.05,
        lowLineCreditHours: 70.68,
        highLineCreditHours: 83.35,
        averageDaysOff: 14.2,
        totalRegularLines: 98,
        totalReserveLines: 5,
        totalSecondaryLines: 54,
      },
    };
    const strategies = generateStrategies(bidPackWithReserve, SENIOR);
    const ladder = strategies.find((s) => s.id === "reserve-ladder");
    expect(ladder).toBeDefined();
    expect(ladder!.mechanism).toContain("2 run 24-Hour (R) reserve");
    expect(ladder!.mechanism).toContain("1 run RA");
    expect(ladder!.mechanism).toContain("1 run RB");
    expect(ladder!.mechanism).toContain("1 whose type wasn't clear");
    expect(ladder!.mechanism).toContain("75.8 hours");
    // RLG (75.75) genuinely beats Low Line Credit (70.68) here, so the floor insight should surface.
    expect(ladder!.benefits.some((b) => b.includes("isn't automatically the losing seat"))).toBe(true);
  });

  it("omits the Reserve Ladder's floor-guarantee claim when RLG doesn't actually beat Low Line Credit", () => {
    const bidPackWithReserve = {
      ...SAMPLE_BID_PACK,
      reserveLines: [{ lineNumber: "7001", reserveType: "24hr" as const }],
      info: {
        rlgHours: 60,
        rDayValueHours: 5,
        lowLineCreditHours: 70,
        highLineCreditHours: 83,
        averageDaysOff: 14,
        totalRegularLines: 98,
        totalReserveLines: 1,
        totalSecondaryLines: 54,
      },
    };
    const strategies = generateStrategies(bidPackWithReserve, SENIOR);
    const ladder = strategies.find((s) => s.id === "reserve-ladder");
    expect(ladder!.benefits.some((b) => b.includes("isn't automatically the losing seat"))).toBe(false);
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

describe("rankStrategiesByPreference", () => {
  it("leaves the order untouched when there's no profile to rank against", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const ranked = rankStrategiesByPreference(strategies, null);
    expect(ranked.map((s) => s.id)).toEqual(strategies.map((s) => s.id));
  });

  it("puts the Ghost Line first for a pilot who weighted credit and deadhead tolerance heavily, and names those reasons", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const weights = { ...emptyWeights(), creditHours: 90, deadheadTolerance: 90 };
    const ranked = rankStrategiesByPreference(strategies, weights);
    const lineStrategies = ranked.filter((s) => !s.isProcessTip);
    expect(lineStrategies[0].id).toBe("ghost-line");
    expect(lineStrategies[0].preferenceMatch?.length).toBeGreaterThan(0);
  });

  it("puts the Metronome ahead of the One-And-Done for a pilot who leans hard toward short trips", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const weights = { ...emptyWeights(), tripLength: -90 };
    const ranked = rankStrategiesByPreference(strategies, weights);
    const recurringIndex = ranked.findIndex((s) => s.id === "recurring-turn");
    const megaIndex = ranked.findIndex((s) => s.id === "mega-trip");
    expect(recurringIndex).toBeLessThan(megaIndex);
  });

  it("always sorts the process-tip strategy to the end, and never gives it a preferenceMatch", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const weights = { ...emptyWeights(), creditHours: 90 };
    const ranked = rankStrategiesByPreference(strategies, weights);
    expect(ranked[ranked.length - 1].id).toBe("re-bid-chain");
    expect(ranked.find((s) => s.id === "re-bid-chain")?.preferenceMatch).toBeUndefined();
  });

  it("ranks the Vacation Vault ahead of strategies unrelated to days off for a pilot who weighted daysOff heavily", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const weights = { ...emptyWeights(), daysOff: 90 };
    const ranked = rankStrategiesByPreference(strategies, weights);
    const vaultIndex = ranked.findIndex((s) => s.id === "vacation-vault");
    const ghostIndex = ranked.findIndex((s) => s.id === "ghost-line");
    expect(vaultIndex).toBeLessThan(ghostIndex);
  });

  it("leaves a strategy with no meaningfully-weighted factors ranked but without invented reasons", () => {
    const strategies = generateStrategies(SAMPLE_BID_PACK, SENIOR);
    const ranked = rankStrategiesByPreference(strategies, emptyWeights());
    for (const s of ranked.filter((s) => !s.isProcessTip)) {
      expect(s.preferenceMatch).toEqual([]);
    }
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
