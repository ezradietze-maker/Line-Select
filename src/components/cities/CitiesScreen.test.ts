import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BidPack, Line, Trip } from "@/types/bidpack";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }), useSearchParams: () => search }));
// The dialog's content, without the portal a server render can't make.
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: unknown }) => children }));
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

describe("a city the airport list doesn't place", () => {
  // A layover in a code the site has no map spot or clock for.
  const away = {
    id: "t2", pairingNumber: "7002", days: 2, layoverCities: ["QXZ"], layoverDetails: [], creditHours: 10, tafbHours: 30, startDayIndex: 2,
    schedule: [
      { reportTimeLocal: "0800", startMinutes: 0, legs: [], layover: { city: "QXZ", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 20, startMinutes: 300, endMinutes: 1500 } },
      { reportTimeLocal: "1100", startMinutes: 1500, legs: [], layover: null },
    ],
  } as unknown as Trip;
  const withAway = { ...pack, lines: [{ id: "l2", lineNumber: "2002", trips: [away] } as unknown as Line] } as BidPack;

  it("doesn't call it 0 nm from the domicile, or draw an empty sky", () => {
    search = new URLSearchParams("city=QXZ");
    const html = renderToStaticMarkup(createElement(CitiesScreen, { bidPack: withAway, profile: null }));
    search = new URLSearchParams();
    expect(html).toContain("In this pack");
    expect(html).not.toMatch(/From MEM, 0 nm/);
    expect(html).not.toContain("The sky there now");
  });
});
