import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { daylightHours, sunTimes } from "@/lib/sun-times";

const local = (ms: number, zone: string) => DateTime.fromMillis(ms, { zone }).toFormat("HH:mm");

describe("sunrise and sunset", () => {
  it("matches published times for Memphis and Honolulu within a few minutes", () => {
    // Memphis, Oct 15 2026: sunrise about 07:06, sunset about 18:23 (CDT).
    const mem = sunTimes(new Date(Date.UTC(2026, 9, 15)), 35.0424, -89.9767)!;
    expect(Math.abs(DateTime.fromFormat(local(mem.sunrise, "America/Chicago"), "HH:mm").diff(DateTime.fromFormat("07:06", "HH:mm"), "minutes").minutes)).toBeLessThanOrEqual(4);
    expect(Math.abs(DateTime.fromFormat(local(mem.sunset, "America/Chicago"), "HH:mm").diff(DateTime.fromFormat("18:23", "HH:mm"), "minutes").minutes)).toBeLessThanOrEqual(4);
    // Honolulu, Jun 21: about 13h26 of daylight.
    expect(daylightHours(sunTimes(new Date(Date.UTC(2026, 5, 21)), 21.3187, -157.9225)!)).toBeCloseTo(13.4, 0);
  });

  it("has no sunrise in the Arctic midwinter", () => {
    expect(sunTimes(new Date(Date.UTC(2026, 11, 21)), 78.2, 15.6)).toBeNull();
  });
});
