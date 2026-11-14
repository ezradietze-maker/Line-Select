import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BidPack, Line, Trip } from "@/types/bidpack";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
const { CitiesScreen } = await import("@/components/cities/CitiesScreen");

/** A line of day trips: nothing in the pack lays over anywhere. */
const dayTrip = { id: "t1", pairingNumber: "7001", days: 1, layoverCities: [], layoverDetails: [], schedule: [], creditHours: 6.4, tafbHours: 10, startDayIndex: 2 } as unknown as Trip;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B777", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [{ id: "l", lineNumber: "2001", trips: [dayTrip] } as unknown as Line] } as unknown as BidPack;

describe("Cities on a pack with no layovers", () => {
  it("says there are none, not \"the 0 cities\" over an empty page", () => {
    const html = renderToStaticMarkup(createElement(CitiesScreen, { bidPack: pack, profile: null }));
    expect(html).not.toContain("The 0 cities");
    expect(html).toContain("No layovers found in this bid pack");
  });
});
