import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { buildPackRow, packColumnCount } from "@/lib/bidpack-row";
import { pairingDate, pastedMatches } from "@/lib/view-add";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

const pack = SAMPLE_BID_PACK;

describe("the sample bid pack", () => {
  it("is on dates, like an uploaded pack: a 28-day period and every trip on its own day", () => {
    expect(pack.bidPeriodStart).toBe("2027-08-30");
    expect(pack.bidPeriodDays).toBe(28);
    for (const line of pack.lines) for (const trip of line.trips) expect(trip.startDayIndex).not.toBeNull();
  });

  it("prints each leg's local and GMT times as the same instant its Zulu time is", () => {
    for (const trip of pack.lines.flatMap((l) => l.trips)) {
      for (const leg of trip.schedule.flatMap((d) => d.legs)) {
        const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toFormat("HHmm");
        expect(at(leg.depTimeZulu, "UTC")).toBe(leg.depTimeGmt);
        expect(at(leg.arrTimeZulu, "UTC")).toBe(leg.arrTimeGmt);
        expect(at(leg.depTimeZulu, timezoneForAirport(leg.depAirport)!)).toBe(leg.depTimeLocal);
        expect(at(leg.arrTimeZulu, timezoneForAirport(leg.arrAirport)!)).toBe(leg.arrTimeLocal);
      }
    }
  });

  it("fills each line's strip with its flights and layover cities on the days they happen", () => {
    const line = pack.lines.find((l) => l.lineNumber === "9004")!;
    const days = buildPackRow(line, pack.bidPeriodStart, pack.bidPeriodDays, packColumnCount(pack));
    const words = (i: number) => days[i].tokens.map((t) => t.text);
    // Trip 501 reports Mon Sep 6 (day 7) to LAX and flies home the next day; trip 502 leaves for Paris on Wed Sep 15.
    expect(words(7)).toEqual(["101", "LAX"]);
    expect(words(8)).toEqual(["LAX", "102"]);
    expect(words(16)).toEqual(["205", "CDG"]);
    expect(words(17)).toEqual(["CDG", "206"]);
    expect(days[7].label).toEqual({ number: "501", creditHours: 7.5 });
  });

  it("can be matched against an open-time list by trip number and date", () => {
    const universe = pack.lines.flatMap((l) => l.trips);
    const c = pack.lines.find((l) => l.lineNumber === "9005")!.trips[1];
    expect(pairingDate(c, pack)).toBe("2027-09-14");
    // Line 9006 flies it the day before, a day out: kept as the next-best match, as on a real pack.
    expect(pastedMatches({ tripNumber: "503", month: 9, day: 14 }, universe, pack).map((m) => [m.trip, m.gap])).toEqual([
      [c, 0],
      [pack.lines.find((l) => l.lineNumber === "9006")!.trips[1], 1],
    ]);
  });
});
