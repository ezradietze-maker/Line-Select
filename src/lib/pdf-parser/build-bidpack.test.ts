import { describe, expect, it } from "vitest";
import { pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import type { ParsedPairing } from "@/lib/pdf-parser/types";

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
