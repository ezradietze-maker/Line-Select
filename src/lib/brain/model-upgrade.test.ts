import { describe, expect, it } from "vitest";
import { modelToDepartures, withHomeFacts } from "@/lib/brain/model-upgrade";
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

describe("withHomeFacts", () => {
  it("takes the crash pad answer from the interview's commute step", () => {
    const m = model(true, []);
    expect(withHomeFacts(m, { hasCrashPad: true }).home?.hasCrashPad).toBe(true);
    expect(withHomeFacts(m, { hasCrashPad: null })).toBe(m);
  });
});

describe("migrateProfile", () => {
  it("upgrades both the working model and the one the pilot confirmed when a saved profile loads", () => {
    const saved = model(true, [crit("trips", "tripCount")]);
    const profile = { hasCrashPad: false, pilotModel: saved, brainInterview: { exchanges: [], choices: [], reviewedModel: saved } } as unknown as PreferenceProfile;
    const loaded = migrateProfile(profile);
    expect(loaded.pilotModel?.criteria[0].metric).toBe("homeDepartures");
    expect(loaded.brainInterview?.reviewedModel?.criteria[0].metric).toBe("homeDepartures");
    expect(loaded.pilotModel?.home?.hasCrashPad).toBe(false);
  });
});
