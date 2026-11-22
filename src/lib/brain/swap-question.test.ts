import { describe, expect, it } from "vitest";
import { explainSwap } from "@/lib/brain/explain-swap";
import { answerSwap, choicesFromSwap, withModel, withoutDrag } from "@/lib/brain/profile-model";
import { learnFromChoices } from "@/lib/brain/reorder-learner";
import { optionFromReason, pickSwapQuestion, untrackedFactor, type SwapQuestion } from "@/lib/brain/swap-question";
import { cleanSwapReason } from "@/lib/brain/swap-reason";
import { prepareMetrics } from "@/lib/metrics/compute";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

const line = (id: string, daysOff: number, credit: number, tafb: number): Line =>
  ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: tafb, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
const pack = {
  id: "p", month: "OCT26", base: "MEM", aircraft: "B767", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28",
  lines: [line("A", 18, 70, 150), line("B", 12, 85, 260), line("C", 15, 78, 200), line("D", 17, 72, 160), line("E", 13, 83, 240), line("F", 14, 71, 230)],
} as unknown as BidPack;
const crit = (id: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label: id === "off" ? "Days off" : "Credit", evidence: [], status: "settled" });
const model: PilotModel = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 0.55)] };
const scored = (m: PilotModel) => new Map(scorePackV2(pack, m, {}).map((s) => [s.lineNumber, s]));
const profile: PreferenceProfile = {
  weights: { ...DEFAULT_WEIGHTS }, deepRoundCompleted: false, tradeoffAnswers: [], explicitTargets: {}, isCommuter: false, hasCrashPad: null, cityPreferences: {},
  completedAt: "2026-11-07T00:00:00.000Z", implicitWeights: {}, implicitConfidence: {}, discoveredFacts: [], interviewTranscript: [],
  pilotModel: model, brainInterview: { exchanges: [], choices: choicesFromSwap(["A", "B"], "s1"), reviewedModel: model },
};

describe("asking why after every swap", () => {
  // F loses to D on both priorities: no weighting of them puts F ahead.
  const unclear = explainSwap(scored(model).get("F")!, scored(model).get("D")!);

  it("asks about a swap nothing explains, offering a measure never named that clearly favours the higher line", () => {
    expect(unclear.verdict).toBe("unexplained");
    // Nothing favours F among the measures either — except, here, nothing: so no new measure is made up.
    expect(untrackedFactor(pack, prepareMetrics(pack), model, "F", "D")).toBeNull();
    // D over E: D has far less time away from base, which the pilot never named.
    expect(untrackedFactor(pack, prepareMetrics(pack), model, "D", "E")).toMatchObject({ metric: "tafbHours", direction: "less" });
    const q = pickSwapQuestion(unclear, { dragId: "s1", higher: "F", lower: "D" }, false, { metric: "tafbHours", direction: "less", label: "Time away from base", amounts: "230 vs 160" });
    // Nothing the pilot named favours F: the measure never named is the guess.
    expect(q).toMatchObject({ kind: "factors", options: [expect.objectContaining({ metric: "tafbHours" })], guess: expect.objectContaining({ metric: "tafbHours" }) });
  });

  it("asks every time, even when one priority explains it: that one is the guess, first, and the pilot can still say otherwise", () => {
    const s = scored(model);
    const clear = explainSwap(s.get("D")!, s.get("B")!);
    const q = pickSwapQuestion(clear, { dragId: "s", higher: "D", lower: "B" }, false, null);
    expect(q?.kind).toBe("factors");
    if (q?.kind !== "factors") return;
    const best = clear.explains[0] ?? clear.factors.find((f) => f.share > 0);
    expect(q.guess?.criterionId).toBe(best?.criterionId);
    expect(q.options[0]).toEqual(q.guess);
    // The same two lines swapped again are asked about again; nothing to offer still asks (something else / about equal).
    expect(pickSwapQuestion(clear, { dragId: "s2", higher: "D", lower: "B" }, false, null)).not.toBeNull();
    expect(pickSwapQuestion(unclear, { dragId: "s3", higher: "C", lower: "D" }, false, null)).toMatchObject({ kind: "factors", options: [], guess: null });
  });

  it("doesn't ask once the pilot turned the questions off", () => {
    expect(pickSwapQuestion(unclear, { dragId: "s", higher: "C", lower: "D" }, true, null)).toBeNull();
  });

  it("asks about a dealbreaker the pilot overrode", () => {
    const limited: PilotModel = { ...model, criteria: [model.criteria[0], { ...model.criteria[1], hardLimit: { op: "min", value: 14 } }] };
    const s = scored(limited);
    const q = pickSwapQuestion(explainSwap(s.get("B")!, s.get("A")!), { dragId: "s", higher: "B", lower: "A" }, false, null);
    expect(q).toMatchObject({ kind: "limit", criterionId: "off", value: 12, op: "min" });
  });
});

describe("what an answer does", () => {
  const question = (options: Extract<SwapQuestion, { kind: "factors" }>["options"], guess = options[0] ?? null): SwapQuestion => ({ kind: "factors", dragId: "s1", higher: "A", lower: "B", options, guess });

  it("counts a named priority as evidence: it comes to count for more against the others offered", () => {
    // Days off and less time away both favour A over B; the pilot says it was the days off.
    const three: PilotModel = { ...model, criteria: [...model.criteria, { ...crit("away", "tafbHours", 0.55), shape: { kind: "less" }, label: "Time away" }] };
    const ratio = (m: PilotModel) => m.criteria.find((c) => c.id === "off")!.weight / m.criteria.find((c) => c.id === "away")!.weight;
    const swapOnly = learnFromChoices(pack, three, choicesFromSwap(["A", "B"], "s1")).model;
    const answered = learnFromChoices(pack, three, choicesFromSwap(["A", "B"], "s1"), undefined, {}, [{ dragId: "s1", higher: "A", lower: "B", kind: "factor", criterionId: "off", offered: ["off", "away"] }]).model;
    expect(ratio(answered)).toBeGreaterThan(ratio(swapOnly) * 1.1);
  });

  it("keeps which reason was guessed, and counts a tap on the guess for less than a reason the pilot picked or typed", () => {
    const off = { criterionId: "off", label: "Days off", amounts: "14 vs 12" };
    const credit = { criterionId: "credit", label: "Credit", amounts: "80 vs 75" };
    const yes = answerSwap(profile, pack, question([off, credit]), { kind: "factor", option: off });
    expect(yes.brainInterview!.swapAnswers).toEqual([expect.objectContaining({ criterionId: "off", guessed: "off" })]);
    const other = answerSwap(profile, pack, question([off, credit]), { kind: "factor", option: credit });
    expect(other.brainInterview!.swapAnswers).toEqual([expect.objectContaining({ criterionId: "credit", guessed: "off" })]);

    const three: PilotModel = { ...model, criteria: [...model.criteria, { ...crit("away", "tafbHours", 0.55), shape: { kind: "less" }, label: "Time away" }] };
    const ratio = (m: PilotModel) => m.criteria.find((c) => c.id === "off")!.weight / m.criteria.find((c) => c.id === "away")!.weight;
    const fit = (extra: object) => learnFromChoices(pack, three, choicesFromSwap(["A", "B"], "s1"), undefined, {}, [{ dragId: "s1", higher: "A", lower: "B", kind: "factor", criterionId: "off", offered: ["off", "away"], ...extra }]).model;
    const swapOnly = learnFromChoices(pack, three, choicesFromSwap(["A", "B"], "s1")).model;
    const picked = ratio(fit({ guessed: "away" }));
    const confirmed = ratio(fit({ guessed: "off" }));
    const typed = ratio(fit({ guessed: "off", text: "the days off" }));
    expect(confirmed).toBeGreaterThan(ratio(swapOnly));
    expect(confirmed).toBeLessThan(picked);
    expect(typed).toBeCloseTo(picked, 6);
  });

  it("learns nothing from a swap the pilot calls about equal", () => {
    const r = learnFromChoices(pack, model, choicesFromSwap(["A", "B"], "s1"), undefined, {}, [{ dragId: "s1", higher: "A", lower: "B", kind: "equal" }]);
    expect(r.model).toBe(model);
  });

  it("adds a measure never named as a new priority, once the pilot agrees", () => {
    const next = answerSwap(profile, pack, question([]), { kind: "factor", option: { metric: "tafbHours", direction: "less", label: "Time away from base", amounts: "150 vs 260" } });
    const added = next.brainInterview!.reviewedModel!.criteria.find((c) => c.metric === "tafbHours");
    expect(added).toMatchObject({ shape: { kind: "less" }, tier: "low" });
    expect(next.brainInterview!.swapAnswers).toEqual([expect.objectContaining({ kind: "factor", criterionId: added!.id })]);
  });

  it("drops or moves a dealbreaker the pilot overrode", () => {
    const limited: PilotModel = { ...model, criteria: [model.criteria[0], { ...model.criteria[1], hardLimit: { op: "min", value: 14 } }] };
    const p = { ...profile, pilotModel: limited, brainInterview: { ...profile.brainInterview!, reviewedModel: limited } };
    const q: SwapQuestion = { kind: "limit", dragId: "s1", higher: "B", lower: "A", criterionId: "off", label: "Days off", value: 12, limit: 14, op: "min", amounts: "12 vs your limit of 14" };
    expect(answerSwap(p, pack, q, { kind: "limit", action: "drop" }).brainInterview!.reviewedModel!.criteria[1].hardLimit).toBeUndefined();
    expect(answerSwap(p, pack, q, { kind: "limit", action: "raise" }).brainInterview!.reviewedModel!.criteria[1].hardLimit).toEqual({ op: "min", value: 12 });
  });

  it("raises a limit far enough to let the line through in a month longer than four weeks", () => {
    // 30 days: a line's days off are judged at four weeks' worth (12 → 11.2), its limit shown in the month's terms.
    const month = { ...pack, bidPeriodDays: 30, lines: [line("A", 18, 70, 150), line("B", 12, 85, 260), line("C", 17, 78, 200), line("D", 18, 72, 160), line("E", 19, 83, 240), line("F", 20, 71, 230)] } as unknown as BidPack;
    const limited: PilotModel = { ...model, criteria: [model.criteria[0], { ...model.criteria[1], hardLimit: { op: "min", value: 15 } }] };
    const broken = scorePackV2(month, limited, {}).find((s) => s.lineNumber === "B")!.violations[0];
    expect(broken).toMatchObject({ criterionId: "off", value: 12 });
    const p = { ...profile, pilotModel: limited, brainInterview: { ...profile.brainInterview!, reviewedModel: limited } };
    const q: SwapQuestion = { kind: "limit", dragId: "s1", higher: "B", lower: "A", criterionId: "off", label: "Days off", value: broken.value, limit: broken.limit, op: "min", amounts: "" };
    const raised = answerSwap(p, month, q, { kind: "limit", action: "raise" });
    expect(scorePackV2(month, raised.brainInterview!.reviewedModel!, {}).find((s) => s.lineNumber === "B")!.violations).toEqual([]);
  });

  it("takes the answer back when its swap is undone", () => {
    const answered = answerSwap(profile, pack, question([{ criterionId: "off", label: "Days off", amounts: "18 vs 12" }]), { kind: "factor", option: { criterionId: "off", label: "Days off", amounts: "18 vs 12" } });
    expect(answered.brainInterview!.swapAnswers).toHaveLength(1);
    const undone = withModel(answered, pack, { choices: withoutDrag(answered.brainInterview!.choices, "s1") }).profile;
    expect(undone.brainInterview!.swapAnswers).toEqual([]);
  });
});

describe("a pilot's own words for a swap", () => {
  const options = { priorities: [{ id: "off", label: "Days off", higher: "18", lower: "18" }], measures: [{ id: "tafbHours", label: "Time away from base", higher: "150", lower: "260" }] };

  it("keeps only what was on the lists", () => {
    expect(cleanSwapReason({ kind: "priority", id: "made-up", direction: null, summary: "x" }, options).kind).toBe("unclear");
    expect(cleanSwapReason({ kind: "measure", id: "tafbHours", direction: null, summary: "x" }, options).kind).toBe("unclear");
    expect(cleanSwapReason({ kind: "measure", id: "tafbHours", direction: "less", summary: "less time away" }, options)).toMatchObject({ kind: "measure", direction: "less" });
  });

  it("says so when the two lines are the same on what the pilot named", () => {
    expect(optionFromReason({ kind: "priority", id: "off", direction: null, summary: "" }, options).same?.id).toBe("off");
    expect(optionFromReason({ kind: "measure", id: "tafbHours", direction: "less", summary: "" }, options).option).toMatchObject({ metric: "tafbHours", amounts: "150 vs 260" });
  });
});
