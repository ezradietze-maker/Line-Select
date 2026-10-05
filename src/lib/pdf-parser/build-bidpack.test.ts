import { describe, expect, it } from "vitest";
import { buildLine, pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import type { DayPlacement } from "@/lib/pdf-parser/line-grid-days";
import type { ParsedLineSummary, ParsedPairing } from "@/lib/pdf-parser/types";

/**
 * A report far from midnight GMT is exactly the case that exposed the real
 * bug: anchoring every pairing to the bid month's own bare start (always
 * 00:00 UTC) silently put every leg's derived Zulu timestamp hours away
 * from its own real printed GMT time, breaking anything that positions a
 * segment from that derived timestamp (Local-mode day-splitting, date-line
 * detection) even though the printed HHMM text displayed correctly. A
 * report already sitting at/near 00:00 UTC would hide this bug entirely,
 * so 21:30 local / 06:30 GMT (real numbers from a real OAK pairing) is
 * deliberately not that.
 */
function makePairing(overrides: Partial<ParsedPairing> = {}): ParsedPairing {
  return {
    id: "p-1",
    sequenceNumber: "42",
    pageNumber: 1,
    days: 1,
    layoverCities: ["HKG"],
    layoverDetails: [],
    reportTime: "evening",
    reportTimeLocal: "2130",
    international: true,
    deadheadLegs: 1,
    creditHours: 10,
    blockHours: 10,
    landings: 1,
    tafbHours: 20,
    effectiveText: "",
    firstFlightNumber: "UA0877",
    flightNumbers: ["UA0877"],
    schedule: [
      {
        reportTimeLocal: "2130",
        startMinutes: 0,
        legs: [
          {
            flightNumber: "UA0877",
            equipment: "JET",
            isDeadhead: true,
            depAirport: "SFO",
            depTimeLocal: "2330",
            depTimeGmt: "0630",
            arrAirport: "HKG",
            arrTimeLocal: "0500",
            arrTimeGmt: "2100",
            blockHours: 14.5,
            startMinutes: 120,
            endMinutes: 990,
          },
        ],
        layover: null,
      },
    ],
    ...overrides,
  };
}

describe("pairingToTrip — zulu anchor", () => {
  it("anchors the pairing's own report to its real GMT time of day, not the bid month's bare start", () => {
    const trip = pairingToTrip(makePairing(), "SEP26");
    // Real printed GMT for the first leg is 06:30 — the derived Zulu
    // timestamp must land exactly there, not at some offset determined by
    // an unrelated shared month-start anchor.
    expect(trip.schedule[0].legs[0].depTimeZulu).toBe("2026-09-01T06:30:00.000Z");
  });

  it("keeps every later leg's Zulu timestamp correctly spaced from the now-correct anchor", () => {
    const trip = pairingToTrip(makePairing(), "SEP26");
    const leg = trip.schedule[0].legs[0];
    const depMs = new Date(leg.depTimeZulu).getTime();
    const arrMs = new Date(leg.arrTimeZulu).getTime();
    // 990 - 120 = 870 elapsed minutes for this leg, preserved regardless of anchor.
    expect((arrMs - depMs) / 60000).toBe(870);
  });

  it("falls back to the bare month start when the pairing has no legs to anchor from", () => {
    const trip = pairingToTrip(makePairing({ schedule: [] }), "SEP26");
    expect(trip.zuluAnchor).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("pairingToTrip — days", () => {
  /**
   * `pairing.days` (from day-letter counting in pairing-parser.ts) only
   * advances on a calendar date that has an actual flight-leg row — a
   * layover longer than 24 hours spans a calendar date with no leg on it
   * at all, so that date never gets counted even though the pilot is still
   * away from base. Real numbers from OAK line 1052: a 24h20m HKG layover
   * between two duty periods, printed as a 2-day pairing but really
   * spanning 4 real calendar dates report to release.
   */
  it("recomputes days from the real anchored schedule instead of trusting the printed day-letter count", () => {
    const pairing = makePairing({
      days: 2,
      tafbHours: 46,
      flightNumbers: ["UA0877", "CX0982"],
      schedule: [
        {
          reportTimeLocal: "2130",
          startMinutes: 0,
          legs: [
            {
              flightNumber: "UA0877",
              equipment: "JET",
              isDeadhead: true,
              depAirport: "SFO",
              depTimeLocal: "2330",
              depTimeGmt: "0630",
              arrAirport: "HKG",
              arrTimeLocal: "0500",
              arrTimeGmt: "2100",
              blockHours: 14.5,
              startMinutes: 120,
              endMinutes: 990,
            },
          ],
          layover: {
            city: "HKG",
            hotelName: "SHERATON",
            transportToHotel: null,
            transportFromHotel: null,
            hours: 24.333333333333332,
            startMinutes: 990,
            endMinutes: 2450,
          },
        },
        {
          reportTimeLocal: "0750",
          startMinutes: 2450,
          legs: [
            {
              flightNumber: "CX0982",
              equipment: "JET",
              isDeadhead: true,
              depAirport: "HKG",
              depTimeLocal: "0750",
              depTimeGmt: "2350",
              arrAirport: "CAN",
              arrTimeLocal: "0855",
              arrTimeGmt: "0055",
              blockHours: 1.0833333333333333,
              startMinutes: 2600,
              endMinutes: 2665,
            },
          ],
          layover: null,
        },
      ],
    });

    const trip = pairingToTrip(pairing, "SEP26");
    expect(trip.days).toBeGreaterThan(pairing.days);
    expect(trip.days).toBe(4);
  });

  it("falls back to the printed day count when there's no schedule to split", () => {
    const trip = pairingToTrip(makePairing({ days: 3, schedule: [] }), "SEP26");
    expect(trip.days).toBe(3);
  });
});

/** A same-day out-and-back — one short daytime leg, no layover — the shape a repeated 1-day pairing actually has. */
function makeOneDayPairing(overrides: Partial<ParsedPairing> = {}): ParsedPairing {
  return {
    id: "p-1",
    sequenceNumber: "12",
    pageNumber: 1,
    days: 1,
    layoverCities: [],
    layoverDetails: [],
    reportTime: "afternoon",
    reportTimeLocal: "1200",
    international: false,
    deadheadLegs: 0,
    creditHours: 4,
    blockHours: 1,
    landings: 2,
    tafbHours: 6,
    effectiveText: "",
    firstFlightNumber: "FX100",
    flightNumbers: ["FX100"],
    schedule: [
      {
        reportTimeLocal: "1200",
        startMinutes: 0,
        legs: [
          {
            flightNumber: "FX100",
            equipment: "76",
            isDeadhead: false,
            depAirport: "MEM",
            depTimeLocal: "1200",
            depTimeGmt: "1700",
            arrAirport: "BHM",
            arrTimeLocal: "1300",
            arrTimeGmt: "1800",
            blockHours: 1,
            startMinutes: 0,
            endMinutes: 60,
          },
        ],
        layover: null,
      },
    ],
    ...overrides,
  };
}

function makeSummary(overrides: Partial<ParsedLineSummary> = {}): ParsedLineSummary {
  return {
    lineNumber: "1001",
    pageNumber: 1,
    seat: "CAP",
    daysOff: 20,
    totalCreditHours: 12,
    totalTafbHours: 18,
    totalBlockHours: 3,
    carryOverCreditHours: 0,
    carryOverBlockHours: 0,
    totalLandings: 6,
    numDutyPeriods: 3,
    flightNumberSequence: [],
    ...overrides,
  };
}

describe("buildLine — consolidating repeated 1-day trips", () => {
  it("merges three consecutive same-pairing 1-day trips into one 3-day trip", () => {
    const pairings = [
      makeOneDayPairing({ id: "p-a" }),
      makeOneDayPairing({ id: "p-b" }),
      makeOneDayPairing({ id: "p-c" }),
    ];
    const placements: DayPlacement[] = [
      { pairingNumber: "12", startDayIndex: 4 },
      { pairingNumber: "12", startDayIndex: 5 },
      { pairingNumber: "12", startDayIndex: 6 },
    ];
    const line = buildLine(makeSummary(), pairings, "SEP26", placements);

    expect(line.trips).toHaveLength(1);
    const trip = line.trips[0];
    expect(trip.days).toBe(3);
    expect(trip.startDayIndex).toBe(4);
    expect(trip.creditHours).toBe(12);
    expect(trip.landings).toBe(6);
    expect(trip.departures).toBe(6);
    expect(trip.schedule).toHaveLength(3);

    // Each occurrence's leg timestamps must land exactly a real day apart —
    // not all piled onto the same instant, which is what you'd get if only
    // the trip's day count changed without re-anchoring the schedule itself.
    const [dep1, dep2, dep3] = trip.schedule.map((duty) => new Date(duty.legs[0].depTimeZulu).getTime());
    expect((dep2 - dep1) / 60000).toBe(1440);
    expect((dep3 - dep1) / 60000).toBe(2880);
  });

  it("does not merge different pairing numbers, even consecutive and 1-day each", () => {
    const pairings = [
      makeOneDayPairing({ id: "p-a", sequenceNumber: "12" }),
      makeOneDayPairing({ id: "p-b", sequenceNumber: "13" }),
    ];
    const placements: DayPlacement[] = [
      { pairingNumber: "12", startDayIndex: 4 },
      { pairingNumber: "13", startDayIndex: 5 },
    ];
    const line = buildLine(makeSummary(), pairings, "SEP26", placements);
    expect(line.trips).toHaveLength(2);
  });

  it("does not merge the same pairing number across a gap in days", () => {
    const pairings = [makeOneDayPairing({ id: "p-a" }), makeOneDayPairing({ id: "p-b" })];
    const placements: DayPlacement[] = [
      { pairingNumber: "12", startDayIndex: 4 },
      { pairingNumber: "12", startDayIndex: 8 },
    ];
    const line = buildLine(makeSummary(), pairings, "SEP26", placements);
    expect(line.trips).toHaveLength(2);
  });

  it("leaves trips unmerged when they have no placed day at all", () => {
    const pairings = [makeOneDayPairing({ id: "p-a" }), makeOneDayPairing({ id: "p-b" }), makeOneDayPairing({ id: "p-c" })];
    const line = buildLine(makeSummary(), pairings, "SEP26");
    expect(line.trips).toHaveLength(3);
    expect(line.trips.every((t) => t.startDayIndex === null)).toBe(true);
  });
});
