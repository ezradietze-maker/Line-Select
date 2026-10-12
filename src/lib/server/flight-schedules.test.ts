import { describe, expect, it } from "vitest";
import { plausible, shiftWeeks, standIn, standIns } from "@/lib/server/flight-schedules";

describe("one real week of departure boards stands in for the month", () => {
  const now = Date.UTC(2026, 9, 11, 18); // Sun Oct 11, 11:00 in San Diego

  it("reads a date further out from the same weekday in the coming week", () => {
    expect(standIn({ airport: "SAN", date: "2026-10-14", half: 1 }, now)).toEqual({ block: { airport: "SAN", date: "2026-10-14", half: 1 }, weeks: 0 });
    expect(standIn({ airport: "SAN", date: "2026-10-22", half: 0 }, now)).toEqual({ block: { airport: "SAN", date: "2026-10-15", half: 0 }, weeks: 1 });
    // The past stands for itself.
    expect(standIn({ airport: "SAN", date: "2026-10-01", half: 0 }, now).weeks).toBe(0);
  });

  it("keeps flights at their local times across a daylight-saving change", () => {
    // AS 792 SAN 09:20 PDT → SEA 12:28 PDT on Oct 15; three weeks on is after clocks fall back on Nov 1.
    const f = { n: "AS 792", from: "SAN", to: "SEA", dep: Date.UTC(2026, 9, 15, 16, 20), arr: Date.UTC(2026, 9, 15, 19, 28) };
    const moved = shiftWeeks(f, 3);
    expect(new Date(moved.dep).toISOString()).toBe("2026-11-05T17:20:00.000Z"); // still 09:20 local, now PST
    expect(moved.arr - moved.dep).toBe(f.arr - f.dep);
  });

  it("reads a date past the airlines' October schedule change from the new schedule's first week, then this week, then last week's flying", () => {
    // Thu Nov 5 is in the winter schedule that starts Sun Oct 25; the coming week still flies the summer one.
    expect(standIns({ airport: "SAN", date: "2026-11-05", half: 0 }, now).map((o) => [o.block.date, o.weeks])).toEqual([
      ["2026-10-29", 1],
      ["2026-10-15", 3],
      ["2026-10-08", 4],
      ["2026-10-01", 5],
    ]);
    // In the coming week: its own date, then the same weekday last week and the week before.
    expect(standIns({ airport: "SAN", date: "2026-10-14", half: 1 }, now).map((o) => o.block.date)).toEqual(["2026-10-14", "2026-10-07", "2026-09-30"]);
  });

  it("drops rows whose times can't be right for their distance", () => {
    const at = (h: number) => Date.UTC(2026, 9, 11) + h * 3_600_000;
    expect(plausible({ n: "WN 2861", from: "LAX", to: "LAS", dep: at(15), arr: at(16.1) })).toBe(true);
    expect(plausible({ n: "WN 2861", from: "LAX", to: "LAS", dep: at(15), arr: at(15.02) })).toBe(false); // one minute
    expect(plausible({ n: "UA 5425", from: "LAX", to: "PHX", dep: at(20), arr: at(-2) })).toBe(false); // lands the day before
    expect(plausible({ n: "KOW 125", from: "SAN", to: "AUS", dep: at(0), arr: at(18.2) })).toBe(false); // 18 hours for 1,900 km
    expect(plausible({ n: "SQ 22", from: "SIN", to: "EWR", dep: at(0), arr: at(18.6) })).toBe(true);
  });
});

