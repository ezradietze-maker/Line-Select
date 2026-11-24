import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripFold } from "@/components/interview/TripGlance";
import { lineFigures, tripDuties, tripHeadline } from "@/lib/brain/line-text";
import { formatHoursValue } from "@/lib/interview-config";
import type { BidPack, Line, Trip } from "@/types/bidpack";

const trip = { id: "t", pairingNumber: "213", days: 2, creditHours: 18 + 56 / 60, tafbHours: 30, startDayIndex: 3, layoverCities: ["IND"], schedule: [] } as unknown as Trip;
const line = { lineNumber: "1001", daysOff: 14, totalCreditHours: 75 + 50 / 60, trips: [trip] } as unknown as Line;
const pack = { bidPeriodStart: "2026-11-30" };

// Round 24: the interview's trip and line cards read credit in tenths, the pack in H:MM: an 18:56 trip read 18.9.
describe("trip and line text: credit as the pack prints it on a screen, in tenths for the brain", () => {
  it("tripHeadline", () => {
    expect(tripHeadline(pack, trip, formatHoursValue)).toBe("Dec 3 · 2d · 18:56 cr · IND");
    expect(tripHeadline(pack, trip)).toBe("Dec 3 · 2d · 18.9 cr · IND");
  });
  it("lineFigures", () => {
    expect(lineFigures(pack, line, formatHoursValue)).toBe("14 days off · 75:50 credit · 1 trip");
    expect(lineFigures(pack, line)).toBe("14 days off · 75.8 credit · 1 trip");
  });
  it("the interview's trip card", () => {
    const html = renderToStaticMarkup(createElement(TripFold, { bidPack: pack as BidPack, trip }));
    expect(html).toContain("18:56 cr");
    expect(html).not.toContain("18.9");
  });
});

// Nov 23: the interview's trip cards got My Rankings' Local/Zulu switch, and their text follows it.
describe("tripDuties: local where it happens, or Zulu", () => {
  const flown = {
    ...trip,
    schedule: [{ legs: [{ flightNumber: "0034", isDeadhead: false, depAirport: "IND", depTimeLocal: "0420", depTimeGmt: "0820", arrAirport: "CDG", arrTimeLocal: "1817", arrTimeGmt: "1617" }], layover: null }],
  } as unknown as Trip;
  it("reads local by default, as the pack prints it (and as the brain's prompts have it)", () => {
    expect(tripDuties(flown)).toEqual(["1. FX 0034 IND 04:20 → CDG 18:17"]);
  });
  it("reads Zulu when switched", () => {
    expect(tripDuties(flown, "zulu")).toEqual(["1. FX 0034 IND 08:20Z → CDG 16:17Z"]);
  });
});
