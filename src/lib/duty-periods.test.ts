import { describe, expect, it } from "vitest";
import { lineDutyPeriods, tripDutyPeriods } from "@/lib/duty-periods";
import { migrateDeparturesToDutyPeriods } from "@/lib/profile-migration";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { buildLine, pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import type { Line, Trip } from "@/types/bidpack";
import type { PreferenceFact } from "@/types/interview-session";

const asTrip = (o: object) => o as unknown as Trip;

describe("duty periods", () => {
  it("reads the stored figure, and falls back to layovers + 1 for a trip saved before it was tracked", () => {
    expect(tripDutyPeriods(asTrip({ dutyPeriods: 5, layoverDetails: [] }))).toBe(5);
    expect(tripDutyPeriods(asTrip({ layoverDetails: [{}, {}, {}] }))).toBe(4);
  });

  it("takes a line's total from its own printed figure when it has one, else sums its trips", () => {
    const trips = [asTrip({ dutyPeriods: 3 }), asTrip({ dutyPeriods: 4 })];
    expect(lineDutyPeriods({ trips, totalDutyPeriods: 9 } as unknown as Line)).toBe(9);
    expect(lineDutyPeriods({ trips } as unknown as Line)).toBe(7);
  });

  it("counts hotel standby days as duty periods (as the bid pack does) but never as departures", () => {
    const pairing = {
      id: "p", sequenceNumber: "1", pageNumber: 1, days: 4, layoverCities: ["IND"],
      // A flight in (with a layover), then three standby days each printing a hotel layover of their own.
      layoverDetails: [{ city: "IND", hotelName: "H" }, { city: "IND", hotelName: "H" }, { city: "IND", hotelName: "H" }, { city: "IND", hotelName: "H" }],
      reportTime: "afternoon", reportTimeLocal: "1200", international: false, deadheadLegs: 0, standbyDays: 3,
      creditHours: 20, blockHours: 5, landings: 2, tafbHours: 60, effectiveText: "", firstFlightNumber: "1", flightNumbers: ["1"], schedule: [],
    };
    const trip = pairingToTrip(pairing as never, "SEP26");
    expect(trip.dutyPeriods).toBe(5);
    expect(trip.departures).toBe(2);
  });

  it("uses the printed NO. DP'S for a parsed line, and the sum otherwise", () => {
    const summary = { lineNumber: "1", pageNumber: 1, seat: "CAP" as const, daysOff: 13, totalCreditHours: 80, totalTafbHours: 240, totalLandings: 9, numDutyPeriods: 0, flightNumberSequence: [] };
    expect(buildLine({ ...summary, printedDutyPeriods: 13 }, null, "SEP26").totalDutyPeriods).toBe(13);
    expect(buildLine(summary, null, "SEP26").totalDutyPeriods).toBe(1);
  });

  it("keeps the sample pack's lines consistent", () => {
    for (const line of SAMPLE_BID_PACK.lines) expect(lineDutyPeriods(line)).toBeGreaterThan(0);
  });
});

describe("migrating a profile saved when duty periods were called departures", () => {
  const fact = (key: string): PreferenceFact => ({
    id: key, statement: "x", kind: "measurable", measurable: { type: "explicit-target", key: key as never, value: 8, rangeRole: "max" },
    confidence: 1, importance: 0.7, severity: "dealbreaker", source: { kind: "adaptive-question", questionId: "q" }, turnIndex: 0,
  });

  it("carries the pinned target, weight and facts across to the new name", () => {
    const old = buildProfile(emptyWeights(), false, []);
    const legacy = {
      ...old,
      weights: { ...old.weights, departures: 0 } as never,
      explicitTargets: { daysOff: 14, departures: { min: 6, max: 10 } } as never,
      discoveredFacts: [fact("departures"), fact("daysOff")],
    };
    const migrated = migrateDeparturesToDutyPeriods(legacy);
    expect(migrated.explicitTargets).toEqual({ daysOff: 14, dutyPeriods: { min: 6, max: 10 } });
    expect("departures" in migrated.weights).toBe(false);
    expect((migrated.discoveredFacts[0].measurable as { key: string }).key).toBe("dutyPeriods");
    expect((migrated.discoveredFacts[1].measurable as { key: string }).key).toBe("daysOff");
    expect(migrated.discoveredFacts[0].severity).toBe("dealbreaker");
  });

  it("leaves a profile that's already on the new name exactly as it was", () => {
    const current = { ...buildProfile(emptyWeights(), false, []), explicitTargets: { dutyPeriods: 8 } };
    expect(migrateDeparturesToDutyPeriods(current).explicitTargets).toEqual({ dutyPeriods: 8 });
  });
});
