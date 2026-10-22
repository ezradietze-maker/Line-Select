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
