import { describe, expect, it } from "vitest";
import { dutyStartOf, tripPictureDays } from "@/components/results/TripPicture";
import { dutyStart, telHref } from "@/components/results/TripDayDetail";
import { buildRawSegments } from "@/lib/trip-timeline";
import type { Trip, TripLeg } from "@/types/bidpack";

const DAY = 1440;
const at = (minutes: number) => new Date(Date.parse("2026-10-12T09:00:00.000Z") + minutes * 60_000).toISOString();
const hhmm = (iso: string, offsetHours: number) => {
  const d = new Date(Date.parse(iso) + offsetHours * 3_600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
/** MEM is five hours behind Zulu in October, IND four. */
const leg = (flightNumber: string, from: string, to: string, start: number, end: number): TripLeg => {
  const off = (a: string) => (a === "MEM" ? -5 : -4);
  return {
    flightNumber,
    equipment: "75",
    isDeadhead: false,
    depAirport: from,
    arrAirport: to,
    depTimeLocal: hhmm(at(start), off(from)),
    depTimeGmt: hhmm(at(start), 0),
    arrTimeLocal: hhmm(at(end), off(to)),
    arrTimeGmt: hhmm(at(end), 0),
    blockHours: (end - start) / 60,
    startMinutes: start,
    endMinutes: end,
    depTimeZulu: at(start),
    arrTimeZulu: at(end),
  } as TripLeg;
};

/** One day of the pairing: MEM-IND-MEM, reporting at 0400 at home and back by 0930. */
const day = (shift: number): Trip["schedule"][number] => ({
  reportTimeLocal: "0400",
  startMinutes: shift,
  legs: [leg("1501", "MEM", "IND", shift + 60, shift + 150), leg("1502", "IND", "MEM", shift + 240, shift + 330)],
  layover: null,
});

/** The same day trip two days running, kept as one trip (`runStarts`). */
const run: Trip = {
  id: "t1506",
  pairingNumber: "1506",
  days: 2,
  layoverCities: [],
  layoverDetails: [],
  reportTime: "early",
  international: false,
  deadheadLegs: 0,
  creditHours: 11,
  landings: 4,
  tafbHours: 11,
  departures: 4,
  zuluAnchor: at(0),
  startDayIndex: 14,
  runStarts: [0, 1],
  schedule: [day(0), day(DAY)],
};

describe("a run of day trips on its trip view", () => {
  it("reports from home each day: Rpt, not a hotel pickup there's no hotel for", () => {
    const starts = tripPictureDays(run, "local").map((d) => dutyStartOf(d, run));
    expect(starts).toEqual([
      { kind: "report", clock: "04:00" },
      { kind: "report", clock: "04:00" },
    ]);
  });

  it("says the second day's report in its day details, on either clock", () => {
    expect(dutyStart(run, 1, "local")).toEqual({ kind: "Report", text: "04:00L" });
    expect(dutyStart(run, 1, "zulu")).toEqual({ kind: "Report", text: "09:00Z" });
  });

  it("names the time before the second day's first flight a report, not a ride from a hotel", () => {
    const ground = buildRawSegments(run).filter((s) => s.kind === "ground");
    expect(ground.map((s) => s.label)).toEqual(["Report", "Report"]);
    expect(ground[1].detail).not.toContain("Hotel pickup");
  });

  it("still starts a duty after a layover at the hotel pickup", () => {
    const withLayover: Trip = {
      ...run,
      runStarts: undefined,
      schedule: [
        { ...day(0), layover: { city: "IND", hours: (DAY - 345) / 60, startMinutes: 345, endMinutes: DAY, pickupTimeLocal: "0400", pickupTimeGmt: "0900" } as Trip["schedule"][number]["layover"] },
        day(DAY),
      ],
    };
    expect(dutyStart(withLayover, 1, "local")).toEqual({ kind: "Pickup", text: "04:00L" });
    expect(tripPictureDays(withLayover, "local").map((d) => dutyStartOf(d, withLayover)?.kind)).toEqual(["report", "pickup"]);
  });
});

describe("a hotel or ride phone's link", () => {
  it("dials the number, then the extension after a pause", () => {
    expect(telHref("+1-907-272-7411")).toBe("tel:+19072727411");
    expect(telHref("215-609-4400 EXT 105")).toBe("tel:2156094400,105");
    expect(telHref("210-341-6000 x 3")).toBe("tel:2103416000,3");
    expect(telHref("317-555-0100 ext: 2")).toBe("tel:3175550100,2");
    expect(telHref("901-555-0100 - CELL")).toBe("tel:9015550100");
  });
});
