import { describe, expect, it } from "vitest";
import { cityDaylight, cityStays, hoursFromBase, offsetWords } from "@/lib/city-guide";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

describe("the city guide", () => {
  it("lists each stay in a city once, with every line that flies it", () => {
    const code = SAMPLE_BID_PACK.lines.flatMap((l) => l.trips.flatMap((t) => t.schedule.flatMap((d) => (d.layover ? [d.layover.city] : []))))[0];
    const stays = cityStays(SAMPLE_BID_PACK, code);
    expect(stays.length).toBeGreaterThan(0);
    expect(stays.every((s) => s.lineNumbers.length >= 1 && s.hours > 0)).toBe(true);
    const keys = stays.map((s) => `${s.tripNumber}|${s.arrive}|${s.hours}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("says the time difference the way a pilot does", () => {
    expect(hoursFromBase("HNL", "MEM", Date.UTC(2026, 9, 15))).toBe(-5);
    expect(offsetWords(-5)).toBe("−5h from the domicile");
    expect(offsetWords(10.5)).toBe("+10½h from the domicile");
    expect(offsetWords(0)).toBe("same time as the domicile");
  });

  it("gives a city's sunrise and sunset on its own clock", () => {
    const hnl = cityDaylight("HNL", "2026-10-15")!;
    expect(hnl.sunrise).toMatch(/^06:/);
    expect(hnl.sunset).toMatch(/^18:/);
  });
});
