import { describe, expect, it } from "vitest";
import { AIRPORT_TIMEZONES } from "@/lib/airport-timezones";
import { isInternationalCity } from "@/lib/pdf-parser/airports";

/** The zones of the 50 states. Puerto Rico and Guam are left out: whether they count as international is a contract question. */
const STATE_ZONES = new Set(["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "America/Boise", "America/Indiana/Indianapolis", "Pacific/Honolulu"]);

describe("isInternationalCity", () => {
  it("calls every airport in the packs that's in the 50 states domestic", () => {
    // A trip touching one it missed was tagged "intl" on the Trade Board: B757 MEM trip 102 (Honolulu, flying to Hilo),
    // trips through Fort Worth Alliance, Rickenbacker, Hartford, Laredo.
    const missed = Object.entries(AIRPORT_TIMEZONES)
      .filter(([code, zone]) => STATE_ZONES.has(zone) && isInternationalCity(code))
      .map(([code]) => code);
    expect(missed).toEqual([]);
  });

  it("still calls the airports outside the US international", () => {
    for (const code of ["CDG", "KIX", "YYZ", "GDL", "RMS", "LHR"]) expect(isInternationalCity(code)).toBe(true);
  });
});
