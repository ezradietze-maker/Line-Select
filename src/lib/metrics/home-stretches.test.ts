import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { Departure } from "@/lib/metrics/departures";
import { homeStretchLabel, homeStretches, summarizeHomeTime } from "@/lib/metrics/home-stretches";

// A 28-day bid period from Monday Sep 28 2026; a commuter living in San Diego, flying out of Memphis.
const ctx = { bidPeriodStart: "2026-09-28", bidPeriodDays: 28, base: "MEM" };
const sd = (iso: string) => DateTime.fromISO(iso, { zone: "America/Los_Angeles" }).toMillis();
const mem = (iso: string) => DateTime.fromISO(iso, { zone: "America/Chicago" }).toMillis();
const dep = (over: Partial<Departure>): Departure => ({
  trips: [], leaveHome: null, backHome: null, reportAt: null, releaseAt: null, start: null, end: null, creditHours: 0, turnHours: [], homeHoursAfter: null, baseCommutes: 0, baseNights: [], jumpseatIns: 0, ...over,
});

describe("time at home", () => {
  it("counts each stretch door to door, and the nights slept at home", () => {
    const ds = [
      dep({ leaveHome: sd("2026-10-12T15:58"), backHome: sd("2026-10-16T16:41") }),
      dep({ leaveHome: sd("2026-10-19T15:58"), backHome: sd("2026-10-23T16:41") }),
    ];
    const s = homeStretches(ds, ctx, ["SAN"])!;
    expect(s.map((x) => x.edge)).toEqual(["start", null, "end"]);
    // Friday 16:41 home, Monday 15:58 out: 71 hours, and the nights of Friday, Saturday and Sunday.
    expect(Math.round(s[1].hours)).toBe(71);
    expect(s[1].nights).toBe(3);
    expect(homeStretchLabel(s[1])).toBe("Home 71h · 3 nights");
  });

  it("calls a stay between departures short when it falls short of a real break, never one that runs into another month", () => {
    const ds = [
      dep({ leaveHome: sd("2026-09-28T09:00"), backHome: sd("2026-10-01T05:00") }),
      dep({ leaveHome: sd("2026-10-03T18:00"), backHome: sd("2026-10-08T05:00") }),
      dep({ leaveHome: sd("2026-10-12T18:00"), backHome: sd("2026-10-25T20:00") }),
    ];
    const t = summarizeHomeTime(homeStretches(ds, ctx, ["SAN"])!);
    // The first morning: the night before leaving is at home. In at 05:00 Thursday, out Saturday evening: 2 nights —
    // short. 05:00 Thursday to Monday evening: 4 nights — a break. The month's last stretch (Sunday 20:00 to the end) is
    // an edge, so it isn't counted as short.
    expect(t.stretches.map((x) => x.nights)).toEqual([1, 2, 4, 0]);
    expect(t.shortGaps).toBe(1);
    expect(t.breakNights).toBe(4);
    expect(t.nightsHome).toBe(7);
    expect(t.longestNights).toBe(4);
    // A pilot who needs only two nights for a real break.
    expect(summarizeHomeTime(t.stretches, 2).shortGaps).toBe(0);
  });

  it("keeps a stay whole when the next departure leaves after the month ends — a five-week line's", () => {
    const ds = [dep({ leaveHome: sd("2026-10-12T04:30"), backHome: sd("2026-10-16T16:00") }), dep({ leaveHome: sd("2026-10-26T04:33"), backHome: sd("2026-10-30T20:00") })];
    const s = homeStretches(ds, ctx, ["SAN"])!;
    expect(s.map((x) => x.edge)).toEqual(["start", null]);
    expect(s[1].to).toBe(sd("2026-10-26T04:33")); // not cut at the month's end
    expect(s[1].nights).toBe(10);
  });

  it("gives a pilot who lives at base the time between release and the next report, less the drive", () => {
    const ds = [dep({ reportAt: mem("2026-10-05T08:00"), releaseAt: mem("2026-10-07T17:00") }), dep({ reportAt: mem("2026-10-09T08:00"), releaseAt: mem("2026-10-10T17:00") })];
    const s = homeStretches(ds, ctx, [])!;
    expect(Math.round(s[1].hours)).toBe(37); // 18:00 Wednesday to 07:00 Friday: Wednesday and Thursday nights
    expect(s[1].nights).toBe(2);
    expect(homeStretches(ds, ctx, ["MEM"])![1].nights).toBe(2);
  });

  it("is a whole month at home with no departures, and unknown when a departure can't be placed", () => {
    const all = homeStretches([], ctx, ["SAN"])!;
    expect(all).toHaveLength(1);
    expect(all[0].nights).toBe(28);
    expect(homeStretches([dep({})], ctx, ["SAN"])).toBeNull();
    expect(homeStretches([], { ...ctx, bidPeriodStart: null }, ["SAN"])).toBeNull();
  });
});
