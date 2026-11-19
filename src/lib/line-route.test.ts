import { describe, expect, it } from "vitest";
import { buildLineTimeline } from "@/lib/line-timeline";
import { dutyRoutes, laneLabels, placeVariants, routesOf, routeText, routeTextVariants } from "@/lib/line-route";
import { pairingToTrip } from "@/lib/pdf-parser/build-bidpack";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import type { Line, Trip } from "@/types/bidpack";

// Rows verbatim from the October 2026 MD-11 Memphis bid pack.
const start = "2026-09-28";
const tripFrom = (rows: string[], startDayIndex: number): Trip => {
  const [pairing] = parsePairingColumn(rows, 1, []);
  return anchorTripToItsDate({ bidPeriodStart: start, base: "MEM" }, { ...pairingToTrip(pairing, "OCT26"), startDayIndex });
};
const HEADER = "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER";
// A deadhead out, one layover, one leg home.
const short = tripFrom(
  [
    "13 MO REPORT AT 2343 (1843) STANDARD CREW",
    "EFFECTIVE OCTOBER 12 - OCTOBER 26",
    HEADER,
    "*MO AA3932 JET MEM 0043(1943) DFW 0233(2133) 01:50 S 00:00 03:12 03:20 DFW 21:50",
    "*TU 1201 26 DFW 0153(2053) MEM 0331(2231) 01:38 01:38 03:12 03:08",
    "LDGS: 1 BLOCK HRS: 01:38 CREDIT HRS: 07:33 T TAFB: 28:18",
  ],
  14
);
// Night hub turns: DFW to IND and back with a sit at the hub, two nights running.
const turns = tripFrom(
  [
    "12 MO REPORT AT 2343 (1843) STANDARD CREW",
    "EFFECTIVE OCTOBER 12 - OCTOBER 19",
    HEADER,
    "*MO AA3932 JET MEM 0043(1943) DFW 0233(2133) 01:50 S 00:00 03:12 03:20 DFW 22:52",
    "*TU 1601 26 DFW 0255(2155) IND 0459(0059) 02:04 DM",
    "TU 1735 26 IND 0735(0335) DFW 0945(0445) 02:10 04:14 06:24 08:20 DFW 15:40",
    "*WE 1601 26 DFW 0255(2155) IND 0459(0059) 02:04 DM",
    "WE 1735 26 IND 0735(0335) DFW 0945(0445) 02:10 04:14 06:24 08:20 DFW 09:02",
    "WE AA2969 JET DFW 2017(1517) MEM 2206(1706) 01:49 S 00:00 03:12 03:19",
    "LDGS: 4 BLOCK HRS: 08:28 CREDIT HRS: 20:00 TAFB: 70:23",
  ],
  0
);
const line: Line = { id: "l", lineNumber: "1039", trips: [turns, short], daysOff: 20, totalCreditHours: 27.55, totalTafbHours: 98.7, totalLandings: 5, totalDepartures: 5 };
const timeline = buildLineTimeline(line, { bidPeriodStart: start, bidPeriodDays: 28, base: "MEM" }, 35);
const routes = routesOf(timeline);

describe("routesOf", () => {
  it("keeps each trip's own legs, layovers and number together, in time order", () => {
    expect(routes.map((r) => r.trip.number)).toEqual(["12", "13"]);
    expect(routes[1].legs.map((l) => l.label)).toEqual(["D/H", "1201"]);
    expect(routes[1].stays.map((s) => s.city)).toEqual(["DFW"]);
  });

  it("labels every flight the pack prints, deadheads as D/H", () => {
    expect(routes[0].legs.map((l) => l.label)).toEqual(["D/H", "1601", "1735", "1601", "1735", "D/H"]);
    expect(routes[0].legs.map((l) => `${l.from}-${l.to}`)).toEqual(["MEM-DFW", "DFW-IND", "IND-DFW", "DFW-IND", "IND-DFW", "DFW-MEM"]);
  });

  it("draws the sit at the hub as a wait, not a layover", () => {
    // Two IND sits, 02:36 each: no hotel, so they're waits between legs.
    expect(routes[0].waits).toHaveLength(2);
    for (const w of routes[0].waits) expect(w.end - w.start).toBe(2 * 60 + 36);
    expect(routes[0].stays.map((s) => s.city)).toEqual(["DFW", "DFW", "DFW"]);
  });
});

describe("laneLabels", () => {
  const overlaps = (spots: { x: number; lane: number }[], widths: number[]) =>
    spots.some((a, i) => spots.some((b, j) => i < j && a.lane === b.lane && a.x < b.x + widths[j] && b.x < a.x + widths[i]));

  it("centres a word on where it belongs when there's room", () => {
    expect(laneLabels([{ at: 50, width: 20 }], 2, 200)).toEqual([{ x: 40, lane: 0 }]);
  });

  it("steps a crowded word up to the next lane, then moves it along, never on top of another", () => {
    const widths = [24, 24, 24, 24];
    const spots = laneLabels(widths.map((width, i) => ({ at: 30 + i * 6, width })), 2, 400);
    expect(spots.map((s) => s.lane)).toEqual([0, 1, 0, 1]);
    expect(overlaps(spots, widths)).toBe(false);
  });

  it("keeps every word apart however tightly they're packed", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 50; run++) {
      const items = Array.from({ length: 30 }, () => ({ at: rand() * 600, width: 12 + rand() * 30 }));
      const spots = laneLabels(items, 3, 600);
      expect(overlaps(spots, items.map((i) => i.width))).toBe(false);
    }
  });

  it("keeps words inside the strip's left edge", () => {
    expect(laneLabels([{ at: 2, width: 30 }], 1, 300)[0].x).toBe(0);
  });
});

describe("dutyRoutes: each duty's route, as the calendar says it", () => {
  const duties = dutyRoutes(timeline);

  it("says where each duty flies, every stop once, in time order", () => {
    // The trip home's deadhead is a duty of its own after the last DFW layover, as the pack prints it.
    expect(duties.map((d) => routeText(d.cities))).toEqual(["MEM-DFW", "DFW-IND-DFW", "DFW-IND-DFW", "DFW-MEM", "MEM-DFW", "DFW-MEM"]);
  });

  it("marks the stops only a deadhead touches, as the calendar draws them magenta", () => {
    expect(duties[0].cities.map((c) => c.deadhead)).toEqual([true, true]);
    expect(duties[1].cities.map((c) => c.deadhead)).toEqual([false, false, false]);
    expect(duties[3].cities.map((c) => c.deadhead)).toEqual([true, true]);
    // A duty that deadheads in and flies out: the stop both touch is a flown one.
    const mixed = dutyRoutes({
      ...timeline,
      duties: [{ start: 0, end: 600 }],
      legs: [
        { start: 60, end: 120, flight: "DH", from: "MEM", to: "DFW", kind: "deadhead" },
        { start: 200, end: 300, flight: "1601", from: "DFW", to: "IND", kind: "flight" },
      ],
    });
    expect(mixed[0].cities).toEqual([
      { code: "MEM", deadhead: true },
      { code: "DFW", deadhead: false },
      { code: "IND", deadhead: false },
    ]);
  });

  it("holds the flying inside its duty, report to release", () => {
    for (const d of duties) {
      expect(d.flyStart).toBeGreaterThanOrEqual(d.start - 1);
      expect(d.flyEnd).toBeLessThanOrEqual(d.end + 1);
    }
  });

  it("says less when there's less room: every stop, then the ends, then where it ends", () => {
    expect(routeTextVariants({ cities: ["MEM", "IND", "DFW"].map((code) => ({ code, deadhead: false })), standby: false }).map(routeText)).toEqual(["MEM-IND-DFW", "MEM-DFW", "DFW"]);
    // A hub turn, back where it began: where it turns.
    expect(routeTextVariants(duties[1]).map(routeText)).toEqual(["DFW-IND-DFW", "IND"]);
    expect(routeTextVariants({ cities: [{ code: "IND", deadhead: false }], standby: true }).map(routeText)).toEqual(["HSBY-IND", "HSBY"]);
  });
});

describe("placeVariants", () => {
  it("keeps the longest words that fit near their place, and says less rather than drift", () => {
    const spots = placeVariants(
      [
        { at: 50, widths: [60, 30, 15] },
        { at: 60, widths: [60, 30, 15] },
        { at: 66, widths: [60, 30, 15] },
      ],
      2,
      400,
      10
    );
    expect(spots[0]).toMatchObject({ lane: 0, variant: 0 });
    expect(spots[1]).toMatchObject({ lane: 1, variant: 0 });
    // Both lanes are taken around 66: its shortest words don't fit within 10px either, so it's left off.
    expect(spots[2]).toBeNull();
  });

  it("never lets two words in one lane touch, and keeps them inside the strip", () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 50; run++) {
      const items = Array.from({ length: 25 }, () => ({ at: rand() * 500, widths: [40 + rand() * 20, 25, 12] }));
      const spots = placeVariants(items, 2, 500, 12);
      const placed = spots.flatMap((s, i) => (s ? [{ ...s, w: items[i].widths[s.variant] }] : []));
      for (const a of placed) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(500.5);
        for (const b of placed) if (a !== b && a.lane === b.lane) expect(a.x + a.w <= b.x || b.x + b.w <= a.x).toBe(true);
      }
    }
  });
});
