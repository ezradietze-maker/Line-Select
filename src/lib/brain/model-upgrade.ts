import type { PilotModel } from "@/types/pilot-model";

/**
 * A commuter counts the month in departures — each time they leave home to fly — not in trips: trips flown back to back
 * without going home are one departure, and one pair of commutes. Models built before the brain knew departures bound
 * those priorities to the trip count and to commutes counted at every trip's ends, which charge a chained trip as if
 * the pilot went home in between.
 *
 * For a commuter, each such priority moves to the measure it meant — same id, label, shape, anchors, limit and weight,
 * so nothing they said is re-weighed; only what's counted changes. A pilot who lives at base keeps the trip count: for
 * them a trip is a departure. Safe to run on any model, any number of times.
 */
export const COMMUTER_MEASURES: Record<string, string> = {
  tripCount: "homeDepartures",
  baseCommutesNeeded: "departureCommutes",
};

export function modelToDepartures(model: PilotModel): PilotModel;
export function modelToDepartures(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToDepartures(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model?.home?.commuter || !model.criteria.some((c) => c.metric in COMMUTER_MEASURES)) return model;
  return { ...model, criteria: model.criteria.map((c) => (c.metric in COMMUTER_MEASURES ? { ...c, metric: COMMUTER_MEASURES[c.metric] } : c)) };
}

/**
 * What the interview's commute step learned that the brain's reading doesn't carry: whether the pilot keeps a crash pad
 * at base (nights there then cost nothing — see `baseHotelNights`), and how many hours at home make going home between
 * trips worth it (under that, the trips are one departure). The pilot's own answers win over anything already set.
 */
export function withHomeFacts(model: PilotModel, facts: { hasCrashPad?: boolean | null; minHomeHours?: number | null }): PilotModel {
  if (!model.home) return model;
  const home = { ...model.home };
  if (facts.hasCrashPad !== null && facts.hasCrashPad !== undefined) home.hasCrashPad = facts.hasCrashPad;
  if (facts.minHomeHours !== null && facts.minHomeHours !== undefined && facts.minHomeHours > 0) home.minHomeHours = facts.minHomeHours;
  return home.hasCrashPad === model.home.hasCrashPad && home.minHomeHours === model.home.minHomeHours ? model : { ...model, home };
}

/**
 * A commuter's pay "after shortening trips" is pay per day away from HOME: that measure already counts the deviated
 * deadheads they'd take from home, and the commute when they can't. Earlier brains bound it to
 * `effectiveCreditPerDayAway`, which shortens trips but counts time from base — it leaves the commute out, and ranked a
 * simulated commuter's lines far off his own (Oct 2026: 0.62 vs 0.77 with only that one measure swapped).
 *
 * The priority moves to `creditPerDayAwayFromHome` with its weight and parameters; its anchors were in from-base hours
 * per day, a different scale, so the shape restarts at "more is better" and a hard limit set on that scale is let go. When the model already weighs pay from home, the
 * two were the same priority read twice, and their weights join on the one measure. Only for a commuter whose home is
 * known — the home measure needs it.
 */
export function modelToHomePay(model: PilotModel): PilotModel;
export function modelToHomePay(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToHomePay(model: PilotModel | null | undefined): PilotModel | null | undefined {
  if (!model?.home?.commuter || !model.home.airports.length) return model;
  const moving = model.criteria.filter((c) => c.metric === "effectiveCreditPerDayAway");
  if (!moving.length) return model;
  const home = model.criteria.find((c) => c.metric === "creditPerDayAwayFromHome");
  if (home) {
    const weight = home.weight + moving.reduce((s, c) => s + c.weight, 0);
    return { ...model, criteria: model.criteria.filter((c) => !moving.includes(c)).map((c) => (c === home ? { ...c, weight } : c)) };
  }
  return { ...model, criteria: model.criteria.map((c) => (moving.includes(c) ? { ...c, metric: "creditPerDayAwayFromHome", shape: { kind: "more" }, hardLimit: undefined } : c)) };
}

/**
 * A priority about weeks of night hub turns that an earlier brain could only bind to the general night streak (the
 * ex-pilot's weeks of back-to-back night hub turning, read as `longestNightStreak`) moves to the hub-turn
 * measure it meant — recognized by its label or the pilot's own words naming hub turns. Same weight; the shape restarts
 * at "none is best", since the streak's anchors were in nights in a row. On his own sort (Oct 2026) the move took his
 * readings from 95.2% to 96.6%.
 */
export function modelToHubTurns(model: PilotModel): PilotModel;
export function modelToHubTurns(model: PilotModel | null | undefined): PilotModel | null | undefined;
export function modelToHubTurns(model: PilotModel | null | undefined): PilotModel | null | undefined {
  const aboutHubTurns = (c: PilotModel["criteria"][number]) => c.metric === "longestNightStreak" && [c.label, ...c.evidence.map((e) => e.quote)].some((t) => /hub[- ]?turn/i.test(t));
  if (!model || !model.criteria.some(aboutHubTurns) || model.criteria.some((c) => c.metric === "nightHubTurnRuns")) return model;
  return { ...model, criteria: model.criteria.map((c) => (aboutHubTurns(c) ? { ...c, metric: "nightHubTurnRuns", shape: { kind: "less", fineAt: 0 } } : c)) };
}
