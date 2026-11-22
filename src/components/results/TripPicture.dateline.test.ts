import { describe, expect, it } from "vitest";
import { dateLineJumpsOn, dutyStartOf, tripPictureDays } from "@/components/results/TripPicture";
import { dayBars } from "@/lib/leg-bars";
import { pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import { buildHomeDays, buildLivedDays } from "@/lib/trip-timeline";

// Real B777 ANC pairing 38, Oct 2026: ANC → ICN (west across the date line) → KIX → XMN → ICN → ANC (east across it).
const rows = [
  "38 SA REPORT AT 1745 (0945) 1 RFO",
  "EFFECTIVE OCTOBER 3 ONLY",
  "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
  "03SA 5132 83 ANC 1845(1045) ICN 0415(1315) 09:30 DH/BH 09:30 09:30 11:00 ICN 27:40",
  "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
  "05MO 6800 83 ICN 0925(1825) KIX 1120(2020) 01:55 DH",
  "05MO 5162 83 KIX 1255(2155) XMN 1645(0045) 03:50 05:45 05:45 08:50 XMN 48:45",
  "Hotel: SHERATON XIAMEN HOTEL (XMN)",
  "#07WE 5161 83 XMN 1900(0300) ICN 2137(0637) 02:37 02:37 03:12 04:07 ICN 24:33",
  "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
  "#08TH 5163 83 ICN 2340(0840) ANC 0741(2341) 08:01 BH/DH 08:01 08:01 09:31",
  "LDGS: 5 BLOCK HRS: 25:53 CREDIT HRS: 35:51 T TAFB: 134:26",
];
const [pairing] = parsePairingColumn(rows, 1, []);
const trip = anchorTripToItsDate({ bidPeriodStart: "2026-09-28", base: "ANC" }, { ...pairingToTrip(pairing, "OCT26"), startDayIndex: 5 });

describe("a trip across the date line, day by day", () => {
  it("lays its days out on each place's local date, in the order they're lived: Oct 9 in Seoul, then Oct 8 again in Anchorage", () => {
    const days = tripPictureDays(trip, "local");
    expect(days).toEqual(buildLivedDays(trip));
    expect(days).not.toEqual(buildHomeDays(trip, "local"));
    expect(days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-08"]);
    expect(days.map((d) => d.again?.jumpMinutes ?? null)).toEqual([null, null, null, null, null, null, null, -17 * 60]);
    expect(days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // The flight carried on in Anchorage is the same duty, not a new start.
    expect(dutyStartOf(days[7], trip)).toBeNull();
    expect(dutyStartOf(days[6], trip)).toMatchObject({ kind: "pickup" });
  });

  it("says each crossing once, on the day it takes off: +17h out west, −17h home east", () => {
    const days = tripPictureDays(trip, "local");
    const jumps = days.flatMap((d) => dateLineJumpsOn(d).map((j) => ({ date: d.date, ...j })));
    expect(jumps).toEqual([
      { date: "2026-10-03", direction: "west", minutes: 17 * 60 },
      { date: "2026-10-09", direction: "east", minutes: -17 * 60 },
    ]);
  });

  it("draws the flight out with a squiggle for the clock's jump, and the flight home cut at the line and carried on from it", () => {
    const days = tripPictureDays(trip, "local");
    const legs = days.flatMap((d) => dayBars(d.segments, 60).legs);
    expect(legs.some((l) => l.flightNumber === "5132" && l.jump?.minutes === 17 * 60)).toBe(true);
    expect(legs.some((l) => l.back)).toBe(false);
    const home = days.map((d) => dayBars(d.segments, 60).legs.filter((l) => l.flightNumber === "5163"));
    // Takes off 08:40 Seoul on Oct 9, crosses the line; carries on from the same moment, 17 hours earlier, in Anchorage.
    expect(home[6].map((l) => [l.rewind, l.depClock, l.end - l.start])).toEqual([["out", "08:40", expect.any(Number)]]);
    expect(home[7].map((l) => [l.rewind, l.arrClock, l.to])).toEqual([["in", "23:41", "ANC"]]);
    const flown = home[6][0].end - home[6][0].start + (home[7][0].end - home[7][0].start);
    expect(Math.round(flown)).toBe(8 * 60 + 1);
  });

  it("marks each crossing where it happens on Zulu's clock", () => {
    const marks = tripPictureDays(trip, "zulu").flatMap((d) => d.segments.filter((s) => s.dateLineMark));
    expect(marks.map((s) => s.leg?.flightNumber)).toEqual(["5132", "5163"]);
  });

  it("keeps the pairing header's crew and dates on the trip", () => {
    expect(trip).toMatchObject({ crew: "1 RFO", effectiveText: "OCTOBER 3 ONLY", operatesOn: ["SA"] });
  });
});
