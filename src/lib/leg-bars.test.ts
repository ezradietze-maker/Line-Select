import { describe, expect, it } from "vitest";
import { dayBars, fitLayoverLabel, labeledStayPieces, layoverHours, LABEL_CHAR_PX, sideBySide, stagger, stayLabelLeft } from "@/lib/leg-bars";
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
    expect(bars.legs).toEqual([{ start: 180, end: 450, from: "MEM", runsIn: false, runsOn: false, to: "SEA", deadhead: false, depClock: "03:00", arrClock: "05:35", flightNumber: "1", cab: false, dateLine: null }]);
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

describe("sideBySide", () => {
  const w = 3 * LABEL_CHAR_PX;
  it("leaves labels with room over their minute, and sets crowded ones next to each other, never on top", () => {
    const [can, nrt, far] = sideBySide([{ at: 18 * H, text: "CAN" }, { at: 18 * H + 20, text: "NRT" }, { at: 6 * H, text: "MEM" }], 200, 6) as number[];
    expect(far).toBeCloseTo(50);
    expect(can).toBeCloseTo(150);
    expect(nrt - can).toBeCloseTo(w + 3);
  });

  it("slides the lot back left rather than run past the day's edge", () => {
    const [a, b] = sideBySide([{ at: 23.9 * H, text: "CAN" }, { at: 24 * H, text: "NRT" }], 200, 6) as number[];
    expect(b + w / 2).toBeCloseTo(206);
    expect(b - a).toBeCloseTo(w + 3);
  });

  it("never pushes a city into the day before when a day has more than fit", () => {
    // A300 MEM line 2001, Fri Oct 2 (trip 148) at 1024 wide: IND YMX, a layover, YMX YUL ATL MEM on a 90px day. Slid
    // back left as one, "IND YMX" landed 37px into Thursday, over its "YMX IND".
    const cities = [
      { at: 1 * H, text: "IND" }, { at: 2.5 * H, text: "YMX" }, { at: 12.5 * H, text: "YMX" },
      { at: 14 * H, text: "YUL" }, { at: 16 * H, text: "ATL" }, { at: 18.5 * H, text: "MEM" },
    ];
    const centers = sideBySide(cities, 90, 6);
    const drawn = cities.map((c, i) => ({ ...c, center: centers[i] })).filter((c) => c.center !== null) as { text: string; center: number }[];
    for (const c of drawn) {
      expect(c.center - w / 2, `${c.text} inside the day`).toBeGreaterThanOrEqual(-6 - 0.01);
      expect(c.center + w / 2, `${c.text} inside the day`).toBeLessThanOrEqual(96 + 0.01);
    }
    for (const [i, c] of drawn.slice(1).entries()) expect(c.center - drawn[i].center, `${drawn[i].text} clear of ${c.text}`).toBeGreaterThanOrEqual(w);
    // The two YMX either side of the layover read as one first; the day's first and last cities stay.
    expect(drawn.map((c) => c.text)).toEqual(expect.arrayContaining(["IND", "MEM"]));
    expect(drawn.filter((c) => c.text === "YMX")).toHaveLength(1);
  });

  it("keeps every city when they fit, a city on both sides of a layover included", () => {
    const centers = sideBySide([{ at: 2 * H, text: "YMX" }, { at: 12 * H, text: "YMX" }], 200, 6);
    expect(centers.every((c) => c !== null)).toBe(true);
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

describe("deadhead cities", () => {
  it("marks a city only deadheads touch, so it's written in the deadhead's color", () => {
    const dh = { kind: "deadhead" as const };
    const bars = dayBars([leg("MEM", "SFO", 14 * H, 17 * H, dh), leg("SFO", "OAK", 17.5 * H, 18.5 * H, dh), leg("OAK", "HNL", 18.75 * H, 23 * H)], 60);
    expect(bars.cities.map((c) => [c.text, !!c.deadhead])).toEqual([
      ["MEM", true],
      ["SFO", true],
      ["OAK", false],
      ["HNL", false],
    ]);
  });
});

describe("layover words", () => {
  it("rounds the length to the hour, as the ex-pilot writes it", () => {
    expect(layoverHours(27.67)).toBe("28h");
    expect(layoverHours(32.4)).toBe("32h");
  });

  it("says as much as fits: the city and the hours, then the city alone — never L/O", () => {
    const wide = fitLayoverLabel("OAK", 28, 200);
    expect(wide).toMatchObject({ hours: true });
    expect(wide.widthPx).toBeCloseTo("OAK 28h".length * LABEL_CHAR_PX);
    expect(fitLayoverLabel("OAK", 28, 30)).toMatchObject({ hours: false });
    // Room for the pilot's mark after it counts too.
    expect(fitLayoverLabel("OAK", 28, "OAK 28h".length * LABEL_CHAR_PX + 4, 10)).toMatchObject({ hours: false });
  });

  it("moves a late stay's words back toward its start so they aren't cut at the day's right edge", () => {
    const text = "L/O SFO 20h".length * LABEL_CHAR_PX;
    // A phone's day 180px wide, the stay from 15:00 (112px), its words after the van at 140px: only 40px left for them.
    const left = stayLabelLeft(140, 112, text, 180);
    expect(left).toBe(112);
    expect(180 - left).toBeGreaterThan(text - 8);
    // Room to spare: they stay just after the van.
    expect(stayLabelLeft(60, 32, text, 180)).toBe(60);
    // Room only part way back: no further than they need.
    expect(stayLabelLeft(140, 60, text, 180)).toBeCloseTo(180 - text);
  });
});

describe("layover ends and rest hotels", () => {
  it("knows whether a layover begins and ends on the day, for the van at each end", () => {
    const night = dayBars([stay("OAK", 18 * H, 24 * H, { continuesToNextDay: true })], 60);
    expect(night.stays[0]).toMatchObject({ runsIn: false, runsOn: true });
    const morning = dayBars([stay("OAK", 0, 9 * H, { continuesFromPreviousDay: true })], 60);
    expect(morning.stays[0]).toMatchObject({ runsIn: true, runsOn: false });
  });

  it("draws a crew-rest hotel between two legs of one duty as a rest, not a layover", () => {
    const rest = piece("connection", 3 * H, 8 * H, { stay: { city: "IND", hotel: "Hyatt", hours: 5, transportTo: null, transportFrom: null } });
    const bars = dayBars([leg("MEM", "IND", 1 * H, 3 * H), rest, leg("IND", "MEM", 8 * H, 10 * H)], 60);
    expect(bars.rests).toEqual([{ start: 180, end: 480, city: "IND", hours: 5, hotel: "Hyatt" }]);
    expect(bars.stays).toEqual([]);
  });
});

describe("times at the day's edge", () => {
  // A phone's trip row is about 207px wide; labels get 40px of room each (`LegBars`).
  const width = 207;
  const minGap = (40 * 24 * H) / width;

  it("spaces a time where it's drawn, nudged in from midnight — not where it would sit past the edge", () => {
    // B757 MEM: SAN 16:14 out (18:14 on MEM's clock) and MEM 23:59 in, on one day. "23:59" is pulled 17px in from the
    // right edge to stay inside the day, which put it on top of "16:14" — "16:1423:59".
    const day = [
      leg("SAN", "PHX", 18 * H + 14, 19 * H + 45, { startClock: "16:14", endClock: "17:45" }),
      leg("PHX", "MEM", 20 * H + 52, 23 * H + 59, { startClock: "18:52", endClock: "23:59" }),
    ];
    const drawn = dayBars(day, minGap, undefined, width).times.map((t) => {
      const half = (t.text.length * LABEL_CHAR_PX) / 2;
      const x = Math.min(Math.max((t.at / (24 * H)) * width, half), width - half);
      return { row: t.row, from: x - half, to: x + half, text: t.text };
    });
    for (const a of drawn) for (const b of drawn) if (a !== b && a.row === b.row) expect(a.to <= b.from || b.to <= a.from, `${a.text} on ${b.text}`).toBe(true);
  });

  it("leaves times in the middle of the day where they were", () => {
    const day = [leg("MEM", "IND", 8 * H, 9 * H, { startClock: "08:00", endClock: "10:00" })];
    expect(dayBars(day, minGap, undefined, width).times).toEqual(dayBars(day, minGap).times);
  });
});
