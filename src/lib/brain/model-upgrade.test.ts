import { describe, expect, it } from "vitest";
import { modelInPilotWords, modelToBodyClock, modelToDepartures, modelToHomePay, withHomeFacts } from "@/lib/brain/model-upgrade";
import { migrateProfile } from "@/lib/profile-migration";
import type { Criterion, PilotModel } from "@/types/pilot-model";
import type { PreferenceProfile } from "@/types/preferences";

const crit = (id: string, metric: string, over: Partial<Criterion> = {}): Criterion => ({
  id, metric, label: id, shape: { kind: "less", fineAt: 2 }, tier: "high", weight: 0.4, confidence: 0.6, evidence: [{ quote: "q", turn: 0 }], status: "settled", ...over,
});
const model = (commuter: boolean, criteria: Criterion[]): PilotModel => ({
  version: 2, home: { airports: commuter ? ["SAN"] : ["MEM"], commuter }, criteria, threads: [], notMeasurable: [], synopsis: "",
});

describe("modelToDepartures", () => {
  it("moves a commuter's trip count and trip-end commutes onto departures, keeping everything they said", () => {
    const trips = crit("fewDepartures", "tripCount", { label: "Few departures", hardLimit: { op: "max", value: 5 } });
    const commutes = crit("memphis", "baseCommutesNeeded", { shape: { kind: "less", fineAt: 4 }, weight: 0.35 });
    const pay = crit("pay", "creditPerDayAwayFromHome", { shape: { kind: "more" } });
    const up = modelToDepartures(model(true, [trips, commutes, pay]));
    expect(up.criteria).toEqual([{ ...trips, metric: "homeDepartures" }, { ...commutes, metric: "departureCommutes" }, pay]);
  });

  it("leaves a pilot who lives at base on the trip count", () => {
    const m = model(false, [crit("trips", "tripCount")]);
    expect(modelToDepartures(m)).toBe(m);
  });

  it("is safe to run again, and on nothing", () => {
    const once = modelToDepartures(model(true, [crit("trips", "tripCount")]));
    expect(modelToDepartures(once)).toBe(once);
    expect(modelToDepartures(null)).toBeNull();
  });
});

describe("modelToHomePay", () => {
  it("moves a commuter's pay after shortening trips onto pay from home, with its weight and params, its anchors and limit let go", () => {
    const eff = crit("pay", "effectiveCreditPerDayAway", { shape: { kind: "more", enoughAt: 9 }, hardLimit: { op: "min", value: 7 }, params: { frontBufferHours: 10 } });
    const legs = crit("legs", "dutiesWithManyLegs");
    const up = modelToHomePay(model(true, [eff, legs]));
    expect(up.criteria).toEqual([{ ...eff, metric: "creditPerDayAwayFromHome", shape: { kind: "more" }, hardLimit: undefined }, legs]);
  });

  it("joins the weights when pay from home is already there — the same priority read twice", () => {
    const home = crit("homePay", "creditPerDayAwayFromHome", { shape: { kind: "more" }, weight: 0.3 });
    const up = modelToHomePay(model(true, [home, crit("pay", "effectiveCreditPerDayAway", { weight: 0.2 })]));
    expect(up.criteria).toHaveLength(1);
    expect(up.criteria[0]).toMatchObject({ id: "homePay", metric: "creditPerDayAwayFromHome" });
    expect(up.criteria[0].weight).toBeCloseTo(0.5, 10);
  });

  it("leaves a pilot who lives at base on pay from base, and is safe to run again", () => {
    const local = model(false, [crit("pay", "effectiveCreditPerDayAway")]);
    expect(modelToHomePay(local)).toBe(local);
    const once = modelToHomePay(model(true, [crit("pay", "effectiveCreditPerDayAway")]));
    expect(modelToHomePay(once)).toBe(once);
    expect(modelToHomePay(null)).toBeNull();
  });
});

describe("withHomeFacts", () => {
  it("takes the crash pad answer from the interview's commute step", () => {
    const m = model(true, []);
    expect(withHomeFacts(m, { hasCrashPad: true }).home?.hasCrashPad).toBe(true);
    expect(withHomeFacts(m, { hasCrashPad: null })).toBe(m);
  });

  it("takes the hours at home worth going home for, and leaves the default when it wasn't asked", () => {
    const m = model(true, []);
    expect(withHomeFacts(m, { minHomeHours: 48 }).home?.minHomeHours).toBe(48);
    expect(withHomeFacts(m, { minHomeHours: null })).toBe(m);
    expect(withHomeFacts(withHomeFacts(m, { minHomeHours: 48 }), { minHomeHours: 12 }).home?.minHomeHours).toBe(12);
  });
});

describe("migrateProfile", () => {
  it("upgrades both the working model and the one the pilot confirmed when a saved profile loads", () => {
    const saved = model(true, [crit("trips", "tripCount")]);
    const profile = { hasCrashPad: false, minHomeHours: 36, pilotModel: saved, brainInterview: { exchanges: [], choices: [], reviewedModel: saved } } as unknown as PreferenceProfile;
    const loaded = migrateProfile(profile);
    expect(loaded.pilotModel?.criteria[0].metric).toBe("homeDepartures");
    expect(loaded.brainInterview?.reviewedModel?.criteria[0].metric).toBe("homeDepartures");
    expect(loaded.pilotModel?.home?.hasCrashPad).toBe(false);
    expect(loaded.brainInterview?.reviewedModel?.home?.minHomeHours).toBe(36);
  });
});

describe("modelInPilotWords", () => {
  it("says a deadhead is caught from home, not joined, in the summary and the priorities' names", () => {
    const join = crit("dh", "tripsJoinedFromHome", { label: "Trips you can join straight from home (West Coast or Pacific deadheads)", evidence: [{ quote: "trips I can join from home", turn: 1 }] });
    const m = { ...model(true, [join]), synopsis: "You want West Coast deadheads you can join from home and shorten." };
    const up = modelInPilotWords(m);
    expect(up.synopsis).toBe("You want West Coast deadheads you can catch from home and shorten.");
    expect(up.criteria[0].label).toBe("Trips you can catch straight from home (West Coast or Pacific deadheads)");
    // Their own words stay theirs.
    expect(up.criteria[0].evidence[0].quote).toBe("trips I can join from home");
  });

  it("leaves a model already in pilot words as it is", () => {
    const m = { ...model(true, [crit("dh", "tripsJoinedFromHome", { label: "Trips that start with a deadhead from home" })]), synopsis: "Few departures." };
    expect(modelInPilotWords(m)).toBe(m);
  });
});

describe("modelToBodyClock", () => {
  it("moves a priority on the old 1–5 star rating to the 1–100 body-clock score, its numbers carried across the scale", () => {
    const easy = crit("easy", "avgCircadianStars", { label: "Easy on the body clock", shape: { kind: "more", enoughAt: 4 }, hardLimit: { op: "min", value: 3 } });
    const hardest = crit("hardest", "worstCircadianStars", { shape: { kind: "target", ideal: 3, tolerance: 1 } });
    const other = crit("nights", "nightsWorked");
    const up = modelToBodyClock(model(false, [easy, hardest, other]));
    expect(up.criteria[0]).toEqual({ ...easy, metric: "bodyClockScore", shape: { kind: "more", enoughAt: 75.25 }, hardLimit: { op: "min", value: 50.5 } });
    expect(up.criteria[1]).toEqual({ ...hardest, metric: "hardestTripBodyClock", shape: { kind: "target", ideal: 50.5, tolerance: 24.75 } });
    expect(up.criteria[2]).toBe(other);
  });

  it("is safe to run again, and on a model without the stars", () => {
    const once = modelToBodyClock(model(false, [crit("easy", "avgCircadianStars", { shape: { kind: "more" } })]));
    expect(modelToBodyClock(once)).toBe(once);
    const none = model(false, [crit("nights", "nightsWorked")]);
    expect(modelToBodyClock(none)).toBe(none);
  });

  it("runs on every saved profile as it loads", () => {
    const p = migrateProfile({ pilotModel: model(false, [crit("easy", "avgCircadianStars", { shape: { kind: "more" } })]) } as Partial<PreferenceProfile>);
    expect(p.pilotModel!.criteria[0].metric).toBe("bodyClockScore");
  });
});
