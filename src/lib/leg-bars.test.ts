import { describe, expect, it } from "vitest";
import { dayBars, labeledStayPieces, stagger } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";

const H = 60;

function leg(dep: string, arr: string, start: number, end: number, extra: Partial<TimelineSegment> = {}): TimelineSegment {
  const deadhead = extra.kind === "deadhead";
  return {
    kind: "flying",
    label: "",
    detail: "",
    inlineStart: "",
    inlineEnd: "",
    startMinuteOfDay: start,
    endMinuteOfDay: end,
    continuesFromPreviousDay: false,
    continuesToNextDay: false,
    leg: { flightNumber: "1", dep, arr, depClock: "", arrClock: "", depClockAlt: "", arrClockAlt: "", blockMinutes: end - start, equipment: "M1", deadhead },
    ...extra,
  };
}

function piece(kind: TimelineSegment["kind"], start: number, end: number, extra: Partial<TimelineSegment> = {}): TimelineSegment {
  return { kind, label: "", detail: "", inlineStart: "", inlineEnd: "", startMinuteOfDay: start, endMinuteOfDay: end, continuesFromPreviousDay: false, continuesToNextDay: false, ...extra };
}

function stay(city: string, start: number, end: number, extra: Partial<TimelineSegment> = {}): TimelineSegment {
  return piece("layover", start, end, { stay: { city, hotel: "Hyatt", hours: 15.8, transportTo: null, transportFrom: null }, ...extra });
}

describe("dayBars", () => {
  it("draws each leg where it flies, with the times it prints", () => {
    const bars = dayBars([leg("MEM", "SEA", 3 * H, 7.5 * H, { startClock: "03:00", endClock: "05:35" })], 60);
    expect(bars.legs).toEqual([{ start: 180, end: 450, from: "MEM", to: "SEA", deadhead: false, depClock: "03:00", arrClock: "05:35" }]);
    expect(bars.cities.map((c) => c.text)).toEqual(["MEM", "SEA"]);
    expect(bars.times.map((t) => t.text)).toEqual(["03:00", "05:35"]);
  });

  it("writes the city two legs share once, between them, when they turn quickly", () => {
    const bars = dayBars([leg("OAK", "AFW", 8 * H, 10 * H), leg("AFW", "OAK", 10.5 * H, 12.5 * H)], 60);
    expect(bars.cities.map((c) => c.text)).toEqual(["OAK", "AFW", "OAK"]);
    expect(bars.cities[1].at).toBe(10.25 * H);
  });

  it("writes it twice when the legs are far apart — a hub turn with hours of sort between", () => {
    const bars = dayBars([leg("MEM", "IND", 1 * H, 2 * H), leg("IND", "MEM", 5 * H, 6 * H)], 60);
    expect(bars.cities.map((c) => c.text)).toEqual(["MEM", "IND", "IND", "MEM"]);
  });

  it("leaves a leg still in the air at midnight without its far end, on both days", () => {
    const tonight = dayBars([leg("LAX", "MEM", 21 * H, 24 * H, { continuesToNextDay: true })], 60);
    expect(tonight.legs[0]).toMatchObject({ from: "LAX", to: null, arrClock: null });
    expect(tonight.cities.map((c) => c.text)).toEqual(["LAX"]);
    const morning = dayBars([leg("LAX", "MEM", 0, 43, { continuesFromPreviousDay: true })], 60);
    expect(morning.legs[0]).toMatchObject({ from: null, to: "MEM", depClock: null });
    expect(morning.cities.map((c) => c.text)).toEqual(["MEM"]);
  });

  it("marks deadheads, and spans the duty from report to the last landing", () => {
    const bars = dayBars([piece("ground", 6.5 * H, 7.5 * H), leg("MEM", "PHX", 7.5 * H, 9 * H, { kind: "deadhead" }), piece("connection", 9 * H, 10 * H), leg("PHX", "SEA", 10 * H, 12 * H), stay("SEA", 12 * H, 24 * H)], 60);
    expect(bars.legs.map((l) => l.deadhead)).toEqual([true, false]);
    expect(bars.duty).toEqual([{ start: 6.5 * H, end: 12 * H }]);
    expect(bars.stays).toMatchObject([{ city: "SEA", start: 12 * H, end: 24 * H, labeled: true }]);
  });

  it("keeps two duties on one day apart", () => {
    const bars = dayBars([leg("MEM", "IAH", 1 * H, 2 * H), stay("IAH", 2 * H, 20 * H), piece("ground", 20 * H, 21 * H), leg("IAH", "MEM", 21 * H, 22 * H)], 60);
    expect(bars.duty).toEqual([
      { start: 1 * H, end: 2 * H },
      { start: 20 * H, end: 22 * H },
    ]);
  });
});

describe("stagger", () => {
  it("moves a label a line out when it would sit on the one before, and drops one with no room on either line", () => {
    const out = stagger(
      [
        { at: 100, text: "a" },
        { at: 120, text: "b" },
        { at: 130, text: "c" },
        { at: 300, text: "d" },
      ],
      60
    );
    expect(out.map((l) => [l.text, l.row])).toEqual([
      ["a", 0],
      ["b", 1],
      ["d", 0],
    ]);
  });
});

describe("labeledStayPieces", () => {
  it("puts a stay's words on its longest piece, across midnight", () => {
    const tonight = stay("LAX", 22 * H, 24 * H, { continuesToNextDay: true });
    const tomorrow = stay("LAX", 0, 24 * H, { continuesFromPreviousDay: true, continuesToNextDay: true });
    const after = stay("LAX", 0, 17 * H, { continuesFromPreviousDay: true });
    const next = stay("SEA", 20 * H, 24 * H);
    const labeled = labeledStayPieces([[tonight], [tomorrow], [after, next]]);
    expect([...labeled]).toEqual([tomorrow, next]);
  });
});
