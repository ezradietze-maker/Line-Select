import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { computeFilterOptions } from "@/lib/line-filter-options";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  blameFilters,
  collectLayoverCities,
  filtersActive,
  filtersKey,
  lineMatchesFilters,
  type LineFilters,
} from "@/lib/line-filters";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { Line, Trip } from "@/types/bidpack";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    pairingNumber: "1",
    days: 2,
    layoverCities: ["LAX"],
    layoverDetails: [{ city: "LAX", hotelName: null }],
    reportTime: "afternoon",
    international: false,
    deadheadLegs: 0,
    creditHours: 10,
    landings: 2,
    tafbHours: 20,
    departures: 1,
    schedule: [],
    zuluAnchor: "",
    startDayIndex: null,
    ...overrides,
  };
}

function makeLine(overrides: Partial<Line> = {}, trips: Trip[] = [makeTrip()]): Line {
  return {
    id: "l1",
    lineNumber: "9001",
    trips,
    daysOff: 15,
    totalCreditHours: 60,
    totalTafbHours: 70,
    totalLandings: 4,
    totalDepartures: 2,
    ...overrides,
  };
}

describe("filtersActive / activeFilterCount", () => {
  it("reports inactive for the empty filter set", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("counts each independently-set dimension once", () => {
    const filters: LineFilters = {
      ...EMPTY_FILTERS,
      minDaysOff: 5,
      minCreditHours: 30,
      maxTripDays: 3,
      tripCount: "3plus",
      reportTimes: new Set(["early"]),
      cities: new Set(["ANC"]),
      noDeadheadsOnly: true,
      noRedEyesOnly: true,
      verifiedOnly: true,
      international: "international",
    };
    expect(filtersActive(filters)).toBe(true);
    expect(activeFilterCount(filters)).toBe(10);
  });
});

describe("lineMatchesFilters — minDaysOff", () => {
  it("excludes a line with fewer days off than the threshold", () => {
    const line = makeLine({ daysOff: 12 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minDaysOff: 15 })).toBe(false);
  });

  it("includes a line with exactly the threshold", () => {
    const line = makeLine({ daysOff: 15 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minDaysOff: 15 })).toBe(true);
  });
});

describe("lineMatchesFilters — report time", () => {
  it("matches when at least one trip reports at a selected time, not all", () => {
    const line = makeLine(
      {},
      [makeTrip({ reportTime: "early" }), makeTrip({ id: "t2", reportTime: "evening" })]
    );
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, reportTimes: new Set(["early"]) })).toBe(true);
  });

  it("excludes a line whose trips report at none of the selected times", () => {
    const line = makeLine({}, [makeTrip({ reportTime: "afternoon" })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, reportTimes: new Set(["early"]) })).toBe(false);
  });
});

describe("lineMatchesFilters — layover city", () => {
  it("matches a line touching any selected city", () => {
    const line = makeLine({}, [makeTrip({ layoverCities: ["ANC", "SEA"] })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, cities: new Set(["SEA"]) })).toBe(true);
  });

  it("excludes a line that never touches a selected city", () => {
    const line = makeLine({}, [makeTrip({ layoverCities: ["LAX"] })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, cities: new Set(["SEA"]) })).toBe(false);
  });
});

describe("lineMatchesFilters — minCreditHours", () => {
  it("excludes a line with fewer credit hours than the threshold", () => {
    const line = makeLine({ totalCreditHours: 45 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minCreditHours: 50 })).toBe(false);
  });

  it("includes a line with exactly the threshold", () => {
    const line = makeLine({ totalCreditHours: 50 });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, minCreditHours: 50 })).toBe(true);
  });
});

describe("lineMatchesFilters — maxTripDays", () => {
  it("excludes a line if any single trip exceeds the cap", () => {
    const line = makeLine({}, [makeTrip({ days: 2 }), makeTrip({ id: "t2", days: 5 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, maxTripDays: 3 })).toBe(false);
  });

  it("includes a line whose longest trip is exactly at the cap", () => {
    const line = makeLine({}, [makeTrip({ days: 3 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, maxTripDays: 3 })).toBe(true);
  });
});

describe("lineMatchesFilters — tripCount", () => {
  it("matches an exact trip count for 1 or 2", () => {
    const oneTrip = makeLine({}, [makeTrip()]);
    const twoTrips = makeLine({}, [makeTrip(), makeTrip({ id: "t2" })]);
    expect(lineMatchesFilters(oneTrip, { ...EMPTY_FILTERS, tripCount: 1 })).toBe(true);
    expect(lineMatchesFilters(twoTrips, { ...EMPTY_FILTERS, tripCount: 1 })).toBe(false);
    expect(lineMatchesFilters(twoTrips, { ...EMPTY_FILTERS, tripCount: 2 })).toBe(true);
  });

  it("treats 3plus as a floor, not an exact match", () => {
    const threeTrips = makeLine({}, [makeTrip(), makeTrip({ id: "t2" }), makeTrip({ id: "t3" })]);
    const fourTrips = makeLine({}, [
      makeTrip(),
      makeTrip({ id: "t2" }),
      makeTrip({ id: "t3" }),
      makeTrip({ id: "t4" }),
    ]);
    expect(lineMatchesFilters(threeTrips, { ...EMPTY_FILTERS, tripCount: "3plus" })).toBe(true);
    expect(lineMatchesFilters(fourTrips, { ...EMPTY_FILTERS, tripCount: "3plus" })).toBe(true);
    const twoTrips = makeLine({}, [makeTrip(), makeTrip({ id: "t2" })]);
    expect(lineMatchesFilters(twoTrips, { ...EMPTY_FILTERS, tripCount: "3plus" })).toBe(false);
  });
});

describe("lineMatchesFilters — noRedEyesOnly", () => {
  const redEyeTrip = makeTrip({
    schedule: [
      {
        reportTimeLocal: "0300",
        startMinutes: 0,
        legs: [
          {
            flightNumber: "1",
            equipment: "76",
            isDeadhead: false,
            depAirport: "MEM",
            depTimeLocal: "0300",
            depTimeGmt: "0900",
            arrAirport: "LAX",
            arrTimeLocal: "0500",
            arrTimeGmt: "1100",
            blockHours: 4,
            startMinutes: 0,
            endMinutes: 240,
            depTimeZulu: "2026-01-01T09:00:00.000Z",
            arrTimeZulu: "2026-01-01T11:00:00.000Z",
          },
        ],
        layover: null,
      },
    ],
  });

  it("excludes a line with a red-eye departure on any trip", () => {
    const line = makeLine({}, [redEyeTrip]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noRedEyesOnly: true })).toBe(false);
  });

  it("includes a line whose trips have no schedule data to flag (nothing to exclude on)", () => {
    const line = makeLine({}, [makeTrip()]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noRedEyesOnly: true })).toBe(true);
  });
});

describe("lineMatchesFilters — verifiedOnly", () => {
  it("excludes an estimated line", () => {
    const line = makeLine({ estimated: true });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, verifiedOnly: true })).toBe(false);
  });

  it("includes a verified (non-estimated) line", () => {
    const line = makeLine({ estimated: false });
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, verifiedOnly: true })).toBe(true);
  });
});

describe("lineMatchesFilters — no deadheads", () => {
  it("excludes a line with any deadhead leg on any trip", () => {
    const line = makeLine({}, [makeTrip({ deadheadLegs: 0 }), makeTrip({ id: "t2", deadheadLegs: 1 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noDeadheadsOnly: true })).toBe(false);
  });

  it("includes a line with zero deadhead legs across every trip", () => {
    const line = makeLine({}, [makeTrip({ deadheadLegs: 0 }), makeTrip({ id: "t2", deadheadLegs: 0 })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, noDeadheadsOnly: true })).toBe(true);
  });
});

describe("lineMatchesFilters — international routing", () => {
  it("international-only excludes an all-domestic line", () => {
    const line = makeLine({}, [makeTrip({ international: false })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "international" })).toBe(false);
  });

  it("domestic-only excludes a line with any international trip", () => {
    const line = makeLine({}, [makeTrip({ international: false }), makeTrip({ id: "t2", international: true })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "domestic" })).toBe(false);
  });

  it("any (default) never excludes on routing", () => {
    const line = makeLine({}, [makeTrip({ international: true })]);
    expect(lineMatchesFilters(line, { ...EMPTY_FILTERS, international: "any" })).toBe(true);
  });
});

describe("collectLayoverCities", () => {
  it("returns every distinct city across all lines and trips, sorted", () => {
    const lines = [
      makeLine({ id: "l1" }, [makeTrip({ layoverCities: ["SEA", "ANC"] })]),
      makeLine({ id: "l2" }, [makeTrip({ layoverCities: ["LAX"] }), makeTrip({ id: "t2", layoverCities: ["ANC"] })]),
    ];
    expect(collectLayoverCities(lines)).toEqual(["ANC", "LAX", "SEA"]);
  });

  it("returns an empty array for lines with no layovers", () => {
    const lines = [makeLine({ id: "l1" }, [makeTrip({ layoverCities: [] })])];
    expect(collectLayoverCities(lines)).toEqual([]);
  });
});

describe("the new filters", () => {
  const with_ = (over: Partial<LineFilters>): LineFilters => ({ ...EMPTY_FILTERS, ...over });

  it("reads TAFB and credit ranges at both ends, and treats 0 as off", () => {
    const line = makeLine({ totalTafbHours: 100, totalCreditHours: 70 });
    expect(lineMatchesFilters(line, with_({ minTafbHours: 100, maxTafbHours: 100 }))).toBe(true);
    expect(lineMatchesFilters(line, with_({ maxTafbHours: 99 }))).toBe(false);
    expect(lineMatchesFilters(line, with_({ minTafbHours: 101 }))).toBe(false);
    expect(lineMatchesFilters(line, with_({ maxCreditHours: 69 }))).toBe(false);
    expect(lineMatchesFilters(line, with_({ minCreditHours: 60, maxCreditHours: 80 }))).toBe(true);
    expect(activeFilterCount(with_({ minTafbHours: 1, maxTafbHours: 2 }))).toBe(1);
  });

  it("finds pairing numbers by part, case-blind, and no filter on blank", () => {
    const line = makeLine({}, [makeTrip({ pairingNumber: "A1234" })]);
    expect(lineMatchesFilters(line, with_({ pairingContains: " a12 " }))).toBe(true);
    expect(lineMatchesFilters(line, with_({ pairingContains: "99" }))).toBe(false);
    expect(activeFilterCount(with_({ pairingContains: "   " }))).toBe(0);
  });

  it("keeps a line whose commute isn't known, and drops only a real no", () => {
    const line = makeLine();
    const ctx = (s: "yes" | "no" | "unknown") => ({ commute: new Map([[line.id, s]]) });
    expect(lineMatchesFilters(line, with_({ commuteOnly: true }), ctx("yes"))).toBe(true);
    expect(lineMatchesFilters(line, with_({ commuteOnly: true }), ctx("unknown"))).toBe(true);
    expect(lineMatchesFilters(line, with_({ commuteOnly: true }), ctx("no"))).toBe(false);
    expect(lineMatchesFilters(line, with_({ commuteOnly: true }))).toBe(true);
  });
});

describe("blameFilters", () => {
  it("says what each filter takes out on its own, most first, with the way to take it off", () => {
    const a = makeLine({ id: "a", daysOff: 10, totalTafbHours: 50 });
    const b = makeLine({ id: "b", daysOff: 20, totalTafbHours: 500 });
    const c = makeLine({ id: "c", daysOff: 10, totalTafbHours: 500 });
    const f: LineFilters = { ...EMPTY_FILTERS, minDaysOff: 15, maxTafbHours: 100 };
    const blame = blameFilters([a, b, c], f);
    expect(blame.map((x) => [x.key, x.removes])).toEqual([
      ["minDaysOff", 2],
      ["tafb", 2],
    ]);
    expect(blame[0].label).toBe("At least 15 days off");
    expect(blame[0].without.minDaysOff).toBe(0);
    expect(blame[0].without.maxTafbHours).toBe(100);
    expect(blameFilters([a], EMPTY_FILTERS)).toEqual([]);
  });
});

describe("filtersKey", () => {
  it("changes with any filter and doesn't care about Set order", () => {
    const k = filtersKey({ ...EMPTY_FILTERS, cities: new Set(["LAX", "ANC"]) });
    expect(filtersKey({ ...EMPTY_FILTERS, cities: new Set(["ANC", "LAX"]) })).toBe(k);
    expect(filtersKey(EMPTY_FILTERS)).not.toBe(k);
    expect(filtersKey({ ...EMPTY_FILTERS, noTakeoffBefore: 0 })).not.toBe(filtersKey(EMPTY_FILTERS));
  });
});

// The 14 October seats, where they exist: they aren't in the repository, so this runs on a machine that has them.
const PACKS_DIR = ".cache/packs";
const seats = existsSync(PACKS_DIR) ? readdirSync(PACKS_DIR).filter((f) => f.startsWith("OCT26") && f.endsWith(".json")) : [];

describe.skipIf(seats.length === 0)("every new filter on the October seats", () => {
  it.each(seats)("%s", (file) => {
    const pack = restoreBidPack(JSON.parse(readFileSync(`${PACKS_DIR}/${file}`, "utf8")));
    const options = computeFilterOptions(pack.lines, pack.bidPeriodStart);
    const ctx = { bidPeriodStart: pack.bidPeriodStart };
    const pass = (f: Partial<LineFilters>) => pack.lines.filter((l) => lineMatchesFilters(l, { ...EMPTY_FILTERS, ...f }, ctx));
    const legsOf = (l: Line) => l.trips.flatMap((t) => computeTripFacts(t).legs);

    // Each offered chip splits the pack, as the options promise.
    for (const n of options.minDaysOffBlockSteps) {
      const kept = pass({ minDaysOffBlock: n }).length;
      expect(kept, `block ${n}`).toBeGreaterThan(0);
      expect(kept, `block ${n}`).toBeLessThan(pack.lines.length);
    }
    for (const n of options.minWeekendSteps) {
      const kept = pass({ minWeekendDaysOff: n }).length;
      expect(kept, `weekend ${n}`).toBeGreaterThan(0);
      expect(kept, `weekend ${n}`).toBeLessThan(pack.lines.length);
    }
    for (const n of options.minLayoverSteps) expect(pass({ minLongestLayoverHours: n }).length, `layover ${n}`).toBeGreaterThan(0);

    // Takeoffs: every leg on what's left is outside the excluded hours.
    for (const l of pass({ noTakeoffBefore: 8 * 60 })) expect(legsOf(l).every((x) => x.depLocalMinute === null || x.depLocalMinute >= 480)).toBe(true);
    for (const l of pass({ noTakeoffAfter: 20 * 60 })) expect(legsOf(l).every((x) => x.depLocalMinute === null || x.depLocalMinute <= 1200)).toBe(true);
    for (const l of pass({ noTakeoffBefore: 22 * 60, noTakeoffAfter: 6 * 60 })) expect(legsOf(l).every((x) => x.depLocalMinute === null || x.depLocalMinute >= 1320 || x.depLocalMinute <= 360)).toBe(true);

    // Deadheads: nothing left starts, ends or both on one; each is at least as strict as the double.
    const nf = pass({ noFrontDeadhead: true });
    const nb = pass({ noBackDeadhead: true });
    const nd = pass({ noDoubleDeadhead: true });
    for (const l of nf) expect(l.trips.every((t) => !computeTripFacts(t).front)).toBe(true);
    for (const l of nb) expect(l.trips.every((t) => !computeTripFacts(t).back)).toBe(true);
    expect(nd.length).toBeGreaterThanOrEqual(Math.max(nf.length, nb.length));

    // Out-and-backs and single-leg duties: "only" and "none" can't overlap, and only ever narrows.
    const only = new Set(pass({ outAndBacks: "only" }).map((l) => l.id));
    const none = new Set(pass({ outAndBacks: "none" }).map((l) => l.id));
    expect([...only].some((id) => none.has(id))).toBe(false);
    for (const l of pass({ singleLegDutiesOnly: true })) {
      for (const t of l.trips) for (const d of computeTripFacts(t).duties) if (d.operatedLegs > 0) expect(d.operatedLegs).toBe(1);
    }

    // Touching a city includes every line that lays over there, and any line only passing through.
    const city = collectLayoverCities(pack.lines)[0];
    if (city) {
      const over = new Set(pass({ cities: new Set([city]) }).map((l) => l.id));
      const touch = new Set(pass({ touchedCities: new Set([city]) }).map((l) => l.id));
      for (const id of over) expect(touch.has(id)).toBe(true);
      for (const l of pack.lines) expect(touch.has(l.id)).toBe(l.trips.some((t) => t.layoverCities.includes(city)) || legsOf(l).some((x) => x.from === city || x.to === city));
    }

    // Pairing number, TAFB: read straight back.
    const pairing = pack.lines.flatMap((l) => l.trips).find((t) => t.pairingNumber)?.pairingNumber;
    if (pairing) for (const l of pass({ pairingContains: pairing })) expect(l.trips.some((t) => t.pairingNumber?.includes(pairing))).toBe(true);
    const tafb = [...pack.lines.map((l) => l.totalTafbHours)].sort((a, b) => a - b);
    const mid = tafb[Math.floor(tafb.length / 2)];
    for (const l of pass({ maxTafbHours: mid })) expect(l.totalTafbHours).toBeLessThanOrEqual(mid);

    // Blame adds up: with one filter on, it names exactly the lines that filter takes out.
    const f = { ...EMPTY_FILTERS, minDaysOff: 999 };
    expect(blameFilters(pack.lines, f, ctx)[0].removes).toBe(pack.lines.filter((l) => l.daysOff < 999).length);
  }, 60_000);
});
