import { describe, expect, it } from "vitest";
import { shiftWeeks, standIn } from "@/lib/server/flight-schedules";

describe("one real week of departure boards stands in for the month", () => {
  const now = Date.UTC(2026, 9, 11, 18); // Sun Oct 11, 11:00 in San Diego

  it("reads a date further out from the same weekday in the coming week", () => {
    expect(standIn({ airport: "SAN", date: "2026-10-14", half: 1 }, now)).toEqual({ block: { airport: "SAN", date: "2026-10-14", half: 1 }, weeks: 0 });
    expect(standIn({ airport: "SAN", date: "2026-11-05", half: 0 }, now)).toEqual({ block: { airport: "SAN", date: "2026-10-15", half: 0 }, weeks: 3 });
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
});
