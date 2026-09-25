import { describe, expect, it } from "vitest";
import { applicableExplicitWeightIds, packHasHotelStandby, uncoveredExplicitWeightIds } from "@/lib/interview-engine";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { buildLineFactChips } from "@/lib/line-summary";
import { buildProfile, emptyWeights } from "@/lib/preference-logic";
import { rankLines } from "@/lib/scoring";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { computeCircadianAssessment } from "@/lib/circadian";
import { backfillStandby, flyingSchedule, lineStandbyDays, packHasStandby, tripStandbyDays } from "@/lib/standby";
import { buildEstimatedTrip, pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { buildRawSegments } from "@/lib/trip-timeline";
import type { BidPack, Line } from "@/types/bidpack";
import type { PreferenceFact } from "@/types/interview-session";
import type { PreferenceProfile } from "@/types/preferences";

/** The sample pack with hotel standby added to the first two lines: line A has one 3-day stint, line B two 1-day stints. */
function packWithStandby(): { pack: BidPack; a: Line; b: Line; c: Line } {
  const [first, second, third, ...rest] = SAMPLE_BID_PACK.lines;
  // One trip per entry in `days`, cloned from the line's first trip (a sample line may only have one).
  const withStandby = (line: Line, days: number[]): Line => ({
    ...line,
    trips: days.map((d) => ({ ...line.trips[0], standbyDays: d })),
  });
  const a = withStandby(first, [3]);
  const b = withStandby(second, [1, 1]);
  const c = { ...third, trips: third.trips.map((t) => ({ ...t, standbyDays: 0 })) };
  return { pack: { ...SAMPLE_BID_PACK, lines: [a, b, c, ...rest] }, a, b, c };
}

function profileWith(hotelStandby: number): PreferenceProfile {
  return { ...buildProfile(emptyWeights(), false, []), weights: { ...emptyWeights(), hotelStandby } };
}

function standbyFact(direction: 1 | -1): PreferenceFact {
  return {
    id: "f-standby",
    statement: "x",
    kind: "measurable",
    measurable: { type: "explicit-weight", key: "hotelStandby", direction },
    confidence: 1,
    importance: 0.8,
    source: { kind: "adaptive-question", questionId: "q" },
    turnIndex: 0,
  };
}

describe("standby counting", () => {
  it("treats a trip from before standby was tracked as zero", () => {
    const { a } = packWithStandby();
    expect(tripStandbyDays({ ...a.trips[0], standbyDays: undefined })).toBe(0);
    expect(lineStandbyDays(a)).toBe(3);
  });

  it("knows whether a pack has any standby", () => {
    expect(packHasStandby(SAMPLE_BID_PACK.lines)).toBe(false);
    expect(packHasStandby(packWithStandby().pack.lines)).toBe(true);
  });
});

describe("hotelStandby scoring", () => {
  it("ranks the standby line lower for a pilot who wants none, higher for one who likes it", () => {
    const { pack, a, c } = packWithStandby();
    const avoid = rankLines(pack, profileWith(-100));
    const like = rankLines(pack, profileWith(100));
    const rank = (list: typeof avoid, line: Line) => list.findIndex((r) => r.line.id === line.id);
    expect(rank(avoid, a)).toBeGreaterThan(rank(avoid, c));
    expect(rank(like, a)).toBeLessThan(rank(like, c));
  });

  it("names hotel standby as a reason when it hurts a line for a pilot who wants none", () => {
    const { pack, a } = packWithStandby();
    const scored = rankLines(pack, profileWith(-100)).find((r) => r.line.id === a.id)!;
    const dim = scored.dimensions.find((d) => d.key === "hotelStandby")!;
    expect(dim.importance).toBeGreaterThan(0);
    expect(dim.match).toBeLessThan(0.5);
  });

  it("carries no weight when no line in the pack has standby at all", () => {
    for (const r of rankLines(SAMPLE_BID_PACK, profileWith(-100))) {
      expect(r.dimensions.find((d) => d.key === "hotelStandby")!.importance).toBe(0);
    }
  });

  it("leaves scores untouched for a pilot with no standby opinion", () => {
    const { pack } = packWithStandby();
    for (const r of rankLines(pack, profileWith(0))) {
      expect(r.dimensions.find((d) => d.key === "hotelStandby")!.importance).toBe(0);
    }
  });

  it("copes with a profile saved before hotelStandby existed", () => {
    const { pack } = packWithStandby();
    const legacy = buildProfile(emptyWeights(), false, []);
    delete (legacy.weights as Partial<typeof legacy.weights>).hotelStandby;
    for (const r of rankLines(pack, legacy)) expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe("standby implicit measures", () => {
  it("measures the longest single run and the number of separate stints per line", () => {
    const { pack, a, b } = packWithStandby();
    const values = computeImplicitLineValues(pack);
    // Line A has the longest run (3 days), line B has the most stints (2) — so each tops its own measure.
    expect(values[a.id].longestStandbyStretchPerLine).toBe(1);
    expect(values[b.id].standbyStintsPerLine).toBe(1);
    expect(values[a.id].standbyStintsPerLine).toBeLessThan(values[b.id].standbyStintsPerLine);
    expect(values[b.id].longestStandbyStretchPerLine).toBeLessThan(values[a.id].longestStandbyStretchPerLine);
  });
});

describe("interview gating and grounding", () => {
  it("reports the pack's real standby numbers to the interview", () => {
    const stats = computeBidPackGroundingStats(packWithStandby().pack);
    expect(stats.hotelStandby).toMatchObject({ linesWithStandby: 2, maxDaysOnALine: 3, longestStretchDays: 3, maxStintsOnALine: 2 });
    expect(packHasHotelStandby(stats)).toBe(true);
  });

  it("does not raise or wait on the topic when the pack has no standby", () => {
    const stats = computeBidPackGroundingStats(SAMPLE_BID_PACK);
    expect(packHasHotelStandby(stats)).toBe(false);
    expect(applicableExplicitWeightIds(false)).not.toContain("hotelStandby");
    expect(uncoveredExplicitWeightIds([], false)).not.toContain("hotelStandby");
  });

  it("keeps wrap-up blocked until hotel standby has been answered, when the pack has it", () => {
    expect(uncoveredExplicitWeightIds([], true)).toContain("hotelStandby");
    expect(uncoveredExplicitWeightIds([standbyFact(-1)], true)).not.toContain("hotelStandby");
  });
});

describe("standby chip", () => {
  it("shows a standby chip only on lines that have it, framed against the pilot's lean", () => {
    const { a, c } = packWithStandby();
    const chip = buildLineFactChips(a, profileWith(-60)).find((x) => x.main.includes("standby"));
    expect(chip).toMatchObject({ main: "3 standby days", tone: "warn" });
    expect(buildLineFactChips(a, profileWith(60)).find((x) => x.main.includes("standby"))?.tone).toBe("good");
    expect(buildLineFactChips(c, profileWith(-60)).some((x) => x.main.includes("standby"))).toBe(false);
  });
});

describe("standby in the trip schedule", () => {
  /** A real sample trip with one extra standby row appended to its first duty, as a pilot's saved (pre-tracking) trip would look. */
  function tripWithStandbyRow(tag: boolean) {
    const base = SAMPLE_BID_PACK.lines.flatMap((l) => l.trips).find((t) => t.schedule.length > 0)!;
    const flightLeg = base.schedule[0].legs[0];
    const standbyLeg = {
      ...flightLeg,
      flightNumber: "STHOTL",
      equipment: "",
      isDeadhead: false,
      blockHours: null,
      ...(tag ? { isStandby: true } : {}),
    };
    const schedule = base.schedule.map((d, i) => (i === 0 ? { ...d, legs: [...d.legs, standbyLeg] } : d));
    return { base, trip: { ...base, standbyDays: undefined, schedule } };
  }

  it("draws a standby row as its own chart category, not as flying", () => {
    const { trip } = tripWithStandbyRow(true);
    const kinds = buildRawSegments({ ...trip, standbyDays: 1 }).map((s) => s.kind);
    expect(kinds).toContain("standby");
    const standbySegment = buildRawSegments({ ...trip, standbyDays: 1 }).find((s) => s.kind === "standby")!;
    expect(standbySegment.label).toContain("Hotel standby");
  });

  it("keeps standby rows out of the flying statistics", () => {
    const { base, trip } = tripWithStandbyRow(true);
    const before = computeTripAnalytics(base);
    const after = computeTripAnalytics(trip);
    expect(after.redEyeDepartures).toBe(before.redEyeDepartures);
    expect(after.legsPerDuty).toEqual(before.legsPerDuty);
    expect(after.totalBlockHours).toEqual(before.totalBlockHours);
  });

  it("fills in standby for a trip saved before it was tracked, from its own schedule", () => {
    const { trip } = tripWithStandbyRow(false);
    const filled = backfillStandby(trip);
    expect(filled.standbyDays).toBe(1);
    expect(filled.schedule[0].legs.some((l) => l.isStandby)).toBe(true);
    // The count always comes from the legs themselves, so a stale number can't survive.
    expect(backfillStandby({ ...filled, standbyDays: 5 }).standbyDays).toBe(1);
  });

  it("also flags the legs on a trip saved with a standby day count but unflagged legs", () => {
    // The short window between "days counted" and "legs flagged": standbyDays is already there, the chart color isn't.
    const { trip } = tripWithStandbyRow(false);
    const halfSaved = { ...trip, standbyDays: 1 };
    const filled = backfillStandby(halfSaved);
    expect(filled.schedule[0].legs.some((l) => l.isStandby)).toBe(true);
    expect(buildRawSegments(filled).some((s) => s.kind === "standby")).toBe(true);
  });
});

describe("departures are landings", () => {
  const partial = (o: object) => o as never;

  it("gives a parsed trip exactly as many departures as landings", () => {
    const pairing = { id: "p", sequenceNumber: "1", pageNumber: 1, days: 2, layoverCities: ["IND"], layoverDetails: [{ city: "IND", hotelName: "H" }, { city: "IND", hotelName: "H" }, { city: "IND", hotelName: "H" }], reportTime: "afternoon", reportTimeLocal: "1200", international: false, deadheadLegs: 0, standbyDays: 3, creditHours: 20, blockHours: 5, landings: 2, tafbHours: 60, effectiveText: "", firstFlightNumber: "1", flightNumbers: ["1"], schedule: [] };
    // Three standby rows each printed a hotel "layover" — which used to inflate departures to 4.
    const trip = pairingToTrip(partial(pairing), "SEP26");
    expect(trip.departures).toBe(2);
    expect(trip.departures).toBe(trip.landings);
  });

  it("gives a trip with no landings (all standby and repositioning) zero departures", () => {
    const trip = pairingToTrip(partial({ id: "p", sequenceNumber: "1", pageNumber: 1, days: 3, layoverCities: [], layoverDetails: [], reportTime: "afternoon", reportTimeLocal: "1200", international: false, deadheadLegs: 0, standbyDays: 3, creditHours: 9, blockHours: 0, landings: 0, tafbHours: 60, effectiveText: "", firstFlightNumber: "1", flightNumbers: ["1"], schedule: [] }), "SEP26");
    expect(trip.departures).toBe(0);
  });

  it("gives an estimated line's trip departures equal to the line's printed landings", () => {
    const trip = buildEstimatedTrip({ lineNumber: "1", pageNumber: 1, seat: "CAP", daysOff: 13, totalCreditHours: 80, totalTafbHours: 240, totalLandings: 9, numDutyPeriods: 0, flightNumberSequence: [] }, "SEP26");
    expect(trip.departures).toBe(9);
  });

  it("keeps flying statistics free of standby duties (no early reports or short rests from them)", () => {
    const base = SAMPLE_BID_PACK.lines.flatMap((l) => l.trips).find((t) => t.schedule.length > 0)!;
    const last = base.schedule[base.schedule.length - 1];
    const standbyDuty = {
      ...last,
      legs: [{ ...last.legs[0], flightNumber: "STHOTL", equipment: "", blockHours: null, isStandby: true as const }],
      layover: { city: "IND", hotelName: "HYATT", transportToHotel: null, transportFromHotel: null, hours: 3, startMinutes: last.startMinutes, endMinutes: last.startMinutes + 180 },
    };
    const trip = { ...base, standbyDays: 4, schedule: [...base.schedule, standbyDuty, standbyDuty, standbyDuty, standbyDuty] };
    expect(flyingSchedule(trip)).toHaveLength(base.schedule.length);
    expect(computeCircadianAssessment(trip, 0)).toEqual(computeCircadianAssessment(base, 0));
  });
});
