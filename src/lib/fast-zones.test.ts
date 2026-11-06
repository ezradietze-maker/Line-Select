import { IANAZone } from "luxon";
import { describe, expect, it } from "vitest";
import { AIRPORT_TIMEZONES } from "@/lib/airport-timezones";
import { originalOffset } from "@/lib/fast-zones";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const start = Date.UTC(2026, 0, 1);
const end = Date.UTC(2028, 0, 1);

describe("remembered time-zone offsets", () => {
  it("give exactly Luxon's answers for every airport, minute by minute around every clock change of 2026–2027", () => {
    let changes = 0;
    let checked = 0;
    for (const name of new Set(Object.values(AIRPORT_TIMEZONES))) {
      const zone = IANAZone.create(name);
      for (let t = start; t < end; t += HOUR) {
        if (originalOffset(zone, t) === originalOffset(zone, t + HOUR)) continue;
        changes++;
        // The two hours around the change, every minute, plus a few seconds either side of each minute.
        for (let m = t - HOUR; m <= t + 2 * HOUR; m += MINUTE) {
          for (const ts of [m, m + 1_000, m + MINUTE - 1]) {
            expect(zone.offset(ts)).toBe(originalOffset(zone, ts));
            checked++;
          }
        }
      }
    }
    expect(changes).toBeGreaterThan(50);
    expect(checked).toBeGreaterThan(40_000);
  });

  it("answer the same for a quarter hour in a zone with no clock changes, and for any instant", () => {
    const zone = IANAZone.create("Asia/Kathmandu");
    for (let t = start; t < start + 3 * HOUR; t += 7 * MINUTE) expect(zone.offset(t)).toBe(345);
    expect(Number.isNaN(zone.offset(NaN))).toBe(Number.isNaN(originalOffset(zone, NaN)));
  });
});
