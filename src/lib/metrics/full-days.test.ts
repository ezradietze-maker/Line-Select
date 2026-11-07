import { describe, expect, it } from "vitest";
import { computeTripFacts, fullDaysOf } from "@/lib/metrics/trip-facts";
import type { Trip } from "@/types/bidpack";

const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
/** A layover landing at `lands` (local) and picked up `hours` later. */
const layover = (lands: string, hours: number) => fullDaysOf(at(lands), Math.round(hours * 60));

describe("full days on a layover, as the ex-pilot counts them", () => {
  it("gives none for 37 hours in Phoenix landing at dawn and out the next evening — no second night", () => {
    expect(layover("0519", 36.7)).toMatchObject({ fullDays: 0, barelyFullDay: false });
  });

  it("counts 34 hours in Seattle, landing 18:55 and picked up at 04:15 two days later, as just barely one", () => {
    expect(layover("1855", 33 + 20 / 60)).toMatchObject({ fullDays: 1, barelyFullDay: true });
    expect(layover("1855", 33.6)).toMatchObject({ fullDays: 1, barelyFullDay: true });
  });

  it("counts 49 hours in Boston, landing 06:23 and out the second morning, as one", () => {
    expect(layover("0623", 48.8)).toMatchObject({ fullDays: 1, barelyFullDay: false });
  });

  it("takes a landing an hour or two past midnight as the night before, and counts every free day between two full nights", () => {
    // In at 01:15, out at 08:00 three days later: three whole days in the city.
    expect(layover("0115", 3 * 24 + 6.75)).toEqual({ fullDays: 3, barelyFullDay: false, fullDayOffsets: [0, 1, 2] });
    // In at 03:30: too late for that day — it goes to sleep.
    expect(layover("0330", 2 * 24 + 4.5).fullDays).toBe(1);
  });

  it("gives none when the morning after starts before about 3:15, or the clock isn't printed", () => {
    expect(layover("1855", 33)).toMatchObject({ fullDays: 0, barelyFullDay: false });
    expect(fullDaysOf(null, 3000)).toMatchObject({ fullDays: 0, barelyFullDay: false });
  });
});

describe("full days on a whole trip", () => {
  it("gives none for a stay at base between standby days", () => {
    const leg = (dep: string, arr: string, start: number, end: number, local: string) => ({ depAirport: dep, arrAirport: arr, startMinutes: start, endMinutes: end, arrTimeLocal: local, deadhead: false });
    const stay = (city: string, start: number, end: number) => ({ city, hours: (end - start) / 60, startMinutes: start, endMinutes: end, hotelName: null });
    // In at 06:23 and out 48.8 hours later: the Boston layover's full day — but none when the stay is at base.
    const out = 383 + 48.8 * 60;
    const trip = (city: string) => ({ schedule: [{ legs: [leg("ANC", city, 0, 383, "0623")], layover: stay(city, 383, out) }, { legs: [leg(city, "ANC", out, out + 300, "1200")], layover: null }] }) as unknown as Trip;
    expect(computeTripFacts(trip("BOS")).layovers[0].fullDays).toBe(1);
    expect(computeTripFacts(trip("ANC")).layovers[0].fullDays).toBe(0);
  });
});
