import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayCheckScreen } from "@/components/pay/PayCheckScreen";
import type { BidPack, Line, Trip } from "@/types/bidpack";

/** One trip flown on three dates of a line: the parser keeps one id for every copy of the same printed trip. */
const copy = (startDayIndex: number) => ({ id: "p-277-2192-0004-44", pairingNumber: "2192", creditHours: 18 + 56 / 60, tafbHours: 40, startDayIndex, schedule: [] }) as unknown as Trip;
const line = { id: "line-2473", lineNumber: "2473", trips: [copy(1), copy(15), copy(22)], carryOverCreditHours: 0 } as unknown as Line;
const pack = { id: "p", month: "OCT26", base: "MEM", aircraft: "B777", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;

describe("Pay check's trips", () => {
  const html = renderToStaticMarkup(createElement(PayCheckScreen, { bidPack: pack, onGoToUpload: () => {} }));

  it("offers each copy of a repeated trip by its date, each its own choice", () => {
    const options = [...html.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].filter((m) => m[2].startsWith("2192"));
    expect(options.map((m) => m[2])).toEqual(["2192 on Sep 29 (18:56 CH)", "2192 on Oct 13 (18:56 CH)", "2192 on Oct 20 (18:56 CH)"]);
    expect(new Set(options.map((m) => m[1])).size).toBe(3);
  });

  it("shows credit to the minute, as the pack prints it", () => {
    expect(html).toContain("18:56");
    expect(html).not.toContain("18.9");
  });

  it("takes the paid credit as text, so 14:30 can be typed", () => {
    expect(html).not.toContain('type="number"');
    // Not a phone's decimal pad either: it has no colon, so the 14:30 the field asks for couldn't be typed on one.
    expect(html).not.toMatch(/inputmode="(decimal|numeric)"/i);
  });
});

describe("Pay check's runs of the same day trip", () => {
  // Trip 30 three days running from Oct 20, kept by the parser as one trip with the days' credit summed.
  const run = {
    id: "p-30",
    pairingNumber: "30",
    days: 3,
    creditHours: 3 * (4 + 16 / 60),
    tafbHours: 22.5,
    startDayIndex: 22,
    layoverDetails: [],
    zuluAnchor: "",
    runStarts: [0, 1, 2],
    schedule: [0, 1, 2].map((i) => ({ reportTimeLocal: "0700", startMinutes: i * 1440, legs: [], layover: null })),
  } as unknown as Trip;
  const runPack = { ...pack, lines: [{ ...line, trips: [run] }] } as BidPack;
  const html = renderToStaticMarkup(createElement(PayCheckScreen, { bidPack: runPack, onGoToUpload: () => {} }));

  it("offers each day as its own trip to claim, with that day's credit", () => {
    const options = [...html.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].filter((m) => m[2].startsWith("30"));
    expect(options.map((m) => m[2])).toEqual(["30 on Oct 20 (4:16 CH)", "30 on Oct 21 (4:16 CH)", "30 on Oct 22 (4:16 CH)"]);
  });
});
