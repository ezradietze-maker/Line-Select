import { describe, expect, it } from "vitest";
import { withModel } from "@/lib/brain/profile-model";
import { QUICK_CHIPS, QUICK_STARTS, quickBriefExchanges, quickBriefProfile, quickBriefReady } from "@/lib/brain/quick-brief";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { PilotModel } from "@/types/pilot-model";

describe("quickBriefExchanges", () => {
  it("is one exchange, the chips numbered in the order they were put", () => {
    const [e, ...rest] = quickBriefExchanges({ chips: ["weekends", "credit"], sentence: "", dates: "" });
    expect(rest).toEqual([]);
    expect(e.turn).toBe(0);
    expect(e.answer).toMatch(/1\. Having my Saturdays[\s\S]*2\. The most credit hours/);
  });

  it("adds their own words and dates when given, and leaves them out when not", () => {
    const [full] = quickBriefExchanges({ chips: ["weekends"], sentence: "  I hate Newark.  ", dates: "Oct 17, firm" });
    expect(full.answer).toContain("In my own words: I hate Newark.");
    expect(full.answer).toContain("Dates I need off: Oct 17, firm");
    const [bare] = quickBriefExchanges({ chips: ["weekends"], sentence: " ", dates: "" });
    expect(bare.answer).not.toContain("In my own words");
    expect(bare.answer).not.toContain("Dates I need off");
  });

  it("reads from a sentence alone, and ignores a chip it doesn't know", () => {
    expect(quickBriefExchanges({ chips: [], sentence: "More days off.", dates: "" })[0].answer).toBe("In my own words: More days off.");
    expect(quickBriefExchanges({ chips: ["gone"], sentence: "x", dates: "" })[0].answer).toBe("In my own words: x");
  });

  it("tells the brain not to invent limits", () => {
    expect(quickBriefExchanges({ chips: ["short-trips"], sentence: "", dates: "" })[0].question).toContain("no hard limits");
  });
});

describe("the chips", () => {
  it("every starting point uses real chips, in an order the pilot can see", () => {
    const ids = new Set(QUICK_CHIPS.map((c) => c.id));
    for (const start of QUICK_STARTS) for (const chip of start.chips) expect(ids.has(chip), `${start.id}: ${chip}`).toBe(true);
    expect(QUICK_STARTS.length).toBeGreaterThanOrEqual(4);
    expect(QUICK_STARTS.length).toBeLessThanOrEqual(6);
  });

  it("no chip states a number, which the brain could read as a limit they gave", () => {
    for (const c of QUICK_CHIPS) expect(c.says, c.id).not.toMatch(/\d/);
  });

  it("the catalog still has the measures the chips are written for", () => {
    for (const metric of ["longestHomeStretch", "daysOff", "weekendDaysOff", "homeDepartures", "dayFlyingShare", "bodyClockScore", "nightHubTurnRuns", "creditPerDayAwayFromHome", "avgTripDays", "extraLegs", "layoverFullDays"]) {
      expect(METRICS_BY_ID.has(metric), metric).toBe(true);
    }
  });
});

describe("quickBriefReady", () => {
  it("needs a chip or a sentence", () => {
    expect(quickBriefReady({ chips: [], sentence: "  " })).toBe(false);
    expect(quickBriefReady({ chips: ["credit"], sentence: "" })).toBe(true);
    expect(quickBriefReady({ chips: [], sentence: "credit" })).toBe(true);
  });
});

describe("quickBriefProfile", () => {
  const model = { criteria: [], home: { airports: [] }, synopsis: "s", threads: [], notMeasurable: [] } as unknown as PilotModel;
  const exchanges = quickBriefExchanges({ chips: ["credit"], sentence: "", dates: "" });

  it("is marked quick, and has what the drag learner refits from", () => {
    const p = quickBriefProfile({ bidPack: { id: "pack" }, model, exchanges, isCommuter: true, commuteFrom: "san", seniorityNumber: 120, prior: null });
    expect(p.source).toBe("quick");
    expect(p.commuteFrom).toBe("SAN");
    expect(p.seniorityNumber).toBe(120);
    expect(p.brainInterview).toMatchObject({ exchanges, choices: [], packId: "pack" });
    expect(p.brainInterview?.reviewedModel).toBeDefined();
    expect(p.pilotModel).toBeDefined();
  });

  it("keeps only what's still the pilot's from before", () => {
    const prior = { strategyReactions: { "reserve-pays-more": "used" }, cityRatings: { SAN: { score: 2 } } } as never;
    const p = quickBriefProfile({ bidPack: { id: "pack" }, model, exchanges, isCommuter: null, commuteFrom: "", seniorityNumber: null, prior });
    expect(p.strategyReactions).toEqual({ "reserve-pays-more": "used" });
    expect(p.cityRatings).toEqual({});
  });

  it("the drag learner works on it: a line dragged over another moves the weights and is kept", () => {
    const criterion = (id: string, metric: string, kind: "more" | "less") => ({ id, metric, shape: { kind }, tier: "major", weight: 0.5, confidence: 0.5, label: id, evidence: [], status: "settled" });
    const real = { ...model, criteria: [criterion("off", "daysOff", "more"), criterion("credit", "creditHours", "more")] } as unknown as PilotModel;
    const before = quickBriefProfile({ bidPack: SAMPLE_BID_PACK, model: real, exchanges, isCommuter: false, commuteFrom: "", seniorityNumber: null, prior: null });
    const order = rankPackV2(SAMPLE_BID_PACK, before.pilotModel!).map((r) => r.lineNumber);
    const choice = { preferred: order[order.length - 1], other: order[0], strength: "strongly" as const, direct: true, dragId: "d1" };
    const { profile: after } = withModel(before, SAMPLE_BID_PACK, { choices: [choice] });
    expect(after.source).toBe("quick");
    expect(after.brainInterview?.choices).toEqual([choice]);
    expect(after.brainInterview?.reviewedModel).toEqual(before.brainInterview?.reviewedModel);
    expect(after.pilotModel?.criteria.map((c) => c.weight)).not.toEqual(before.pilotModel?.criteria.map((c) => c.weight));
  });
});
