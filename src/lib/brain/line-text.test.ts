import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripFold } from "@/components/interview/TripGlance";
import { lineFigures, tripHeadline } from "@/lib/brain/line-text";
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
