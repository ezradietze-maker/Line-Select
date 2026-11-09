import ICAL from "ical.js";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFeedMonth, renderFeed, withFeedMonth, type FeedMonth } from "@/lib/calendar-feed";
import { expandBidPack } from "@/lib/bidpack-storage";
import { parseBidCalendarPage } from "@/lib/pdf-parser/bid-calendar-parser";
import type { ExtractedPage } from "@/lib/pdf-parser/text-extraction";
import cover from "@/lib/pdf-parser/fixtures/bid-calendar-oct26-md11-mem.json";
import type { TravelAnswer } from "@/lib/flights/itineraries";
import { travelKey } from "@/lib/flights/needs";
import type { BidPack, Line, Trip } from "@/types/bidpack";

const bidCalendar = parseBidCalendarPage(cover as ExtractedPage);

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    pairingNumber: "27",
    days: 3,
    layoverCities: ["NRT"],
    layoverDetails: [],
    reportTime: "early",
    international: true,
    deadheadLegs: 0,
    creditHours: 18.5,
    landings: 2,
    departures: 2,
    tafbHours: 50.5,
    zuluAnchor: "",
    startDayIndex: 2,
    schedule: [
      {
        reportTimeLocal: "0930",
        startMinutes: 0,
        legs: [],
        layover: {
          city: "NRT",
          hotelName: "Hôtel Narita; Tower, East",
          hotelPhone: "+81 476-33",
          transportToHotel: "Limo Co",
          transportFromHotel: "Limo Co",
          transportToPhone: "111",
          transportFromPhone: "222",
          pickupTimeLocal: "1045",
          hours: 24.5,
          startMinutes: 600,
          endMinutes: 2070,
        },
      },
      { reportTimeLocal: "1200", startMinutes: 2070, legs: [], layover: null },
    ],
    ...over,
  };
}

const line = (over: Partial<Line> = {}): Line => ({
  id: "l1",
  lineNumber: "1004",
  trips: [trip(), trip({ id: "t2", pairingNumber: "31", startDayIndex: 10 })],
  daysOff: 5,
  totalCreditHours: 70,
  totalTafbHours: 100,
  totalLandings: 4,
  totalDepartures: 4,
  gridOffDays: [0, 1, 5, 6, 7, 40],
  ...over,
});

const pack = (over: Partial<BidPack> = {}): BidPack => ({
  id: "OCT26-MEM-MD11-CAP",
  month: "OCT26",
  base: "MEM",
  aircraft: "MD11",
  seat: "CAP",
  bidPeriodDays: 28,
  bidPeriodStart: "2026-09-28",
  lines: [line(), line({ id: "l2", lineNumber: "1005", trips: [trip({ startDayIndex: 2 }), trip({ id: "t9", pairingNumber: "99", startDayIndex: 20 })] })],
  bidCalendar,
  ...over,
});

const NOW = Date.UTC(2026, 8, 1);
const month = (over: Partial<Parameters<typeof buildFeedMonth>[1]> = {}, p = pack()) => buildFeedMonth(p, { lineNumber: "1004", lineSource: "top", now: NOW, ...over });

function parsed(ics: string): ICAL.Event[] {
  const comp = new ICAL.Component(ICAL.parse(ics));
  return comp.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
}

/** The RFC 5545 rules a lenient parser lets through. */
function expectValid(ics: string) {
  expect(ics.endsWith("\r\n")).toBe(true);
  for (const physical of ics.slice(0, -2).split("\r\n")) {
    expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
    expect(physical).not.toMatch(/[\r\n]/);
  }
  const unfolded = ics.replace(/\r\n /g, "");
  expect(unfolded).toMatch(/^PRODID:/m);
  expect(unfolded).toMatch(/^VERSION:2\.0$/m);
  const blocks = unfolded.split("BEGIN:VEVENT\r\n").slice(1);
  const uids = new Set<string>();
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const uid = body.match(/^UID:(.+)$/m)?.[1];
    expect(uid).toBeTruthy();
    expect(uids.has(uid!)).toBe(false);
    uids.add(uid!);
    expect(body).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/m);
    const timed = body.match(/^DTSTART:(\d{8}T\d{6}Z)$/m);
    const allDay = body.match(/^DTSTART;VALUE=DATE:(\d{8})$/m);
    expect(!!timed || !!allDay).toBe(true);
    // DTEND has to be after DTSTART, and of the same type.
    const end = timed ? body.match(/^DTEND:(\d{8}T\d{6}Z)$/m)?.[1] : body.match(/^DTEND;VALUE=DATE:(\d{8})$/m)?.[1];
    expect(end).toBeTruthy();
    expect(end! > (timed?.[1] ?? allDay![1])).toBe(true);
    for (const text of body.matchAll(/^(?:SUMMARY|DESCRIPTION):(.*)$/gm)) {
      // TEXT values: every comma, semicolon and backslash escaped, and no bare newline.
      expect(text[1]).not.toMatch(/(^|[^\\])(\\\\)*[,;]/);
    }
  }
  expect(unfolded.match(/BEGIN:VEVENT/g)?.length).toBe(unfolded.match(/END:VEVENT/g)?.length);
}

describe("the feed's output", () => {
  it("is valid iCalendar: parsed strictly, and to the rules a parser lets through", () => {
    const ics = renderFeed([month()], { homeDays: true });
    expectValid(ics);
    expect(parsed(ics).length).toBeGreaterThan(9);
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT6H");
    expect(ics).toContain("X-PUBLISHED-TTL:PT6H");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("folds on octets, without breaking a multi-byte character", () => {
    const ics = renderFeed([month()], { homeDays: false });
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(String.raw`Hôtel Narita\; Tower\, East`);
    const trip27 = parsed(ics).find((e) => e.summary.startsWith("Trip 27"))!;
    expect(trip27.description).toContain("Hôtel Narita; Tower, East");
  });

  it("carries a trip's real times, hotel, rides and pickup", () => {
    const trip27 = parsed(renderFeed([month()], { homeDays: false })).find((e) => e.summary.startsWith("Trip 27"))!;
    // Sep 28 + 2 days, 0930 in Memphis (CDT) = 1430 UTC.
    expect(trip27.startDate.toJSDate().toISOString()).toBe("2026-09-30T14:30:00.000Z");
    expect(trip27.endDate.toJSDate().toISOString()).toBe("2026-10-02T17:00:00.000Z");
    expect(trip27.description).toContain("Report: Wed Sep 30 09:30 MEM time");
    expect(trip27.description).toContain("Release: Fri Oct 2 12:00 MEM time");
    expect(trip27.description).toContain("Hotel: Hôtel Narita; Tower, East, +81 476-33");
    expect(trip27.description).toContain("Ride to hotel: Limo Co, 111");
    expect(trip27.description).toContain("Pickup: 10:45 NRT time");
    expect(trip27.description).toContain("Ride back: Limo Co, 222");
  });

  it("says plainly when a line is only the pilot's #1, and when it's the award", () => {
    const top = parsed(renderFeed([month()], { homeDays: false })).find((e) => e.summary.startsWith("Trip 27"))!;
    expect(top.summary).toContain("your #1");
    expect(top.description).toContain("Not an award.");
    const awarded = parsed(renderFeed([month({ lineSource: "awarded" })], { homeDays: false })).find((e) => e.summary.startsWith("Trip 27"))!;
    expect(awarded.summary).not.toContain("#1");
    expect(awarded.description).toContain("your award");
  });

  it("marks estimated timeline events in their title", () => {
    const counted = month({ pilotClose: "2026-12-07T18:00:00.000Z" }, pack({ month: "JAN27", bidCalendar: undefined }));
    const titles = parsed(renderFeed([counted], { homeDays: false })).map((e) => e.summary);
    expect(titles).toContain("JAN27 bid closes");
    expect(titles).toContain("JAN27 View/Add window opens (estimated)");
  });

  it("adds Home days only when asked, as runs inside the bid period", () => {
    const off = parsed(renderFeed([month()], { homeDays: false }));
    expect(off.some((e) => e.summary === "Home")).toBe(false);
    const home = parsed(renderFeed([month()], { homeDays: true })).filter((e) => e.summary === "Home");
    expect(home.map((e) => [e.startDate.toString(), e.endDate.toString()])).toEqual([
      ["2026-09-28", "2026-09-30"],
      ["2026-10-03", "2026-10-06"],
    ]);
    expect(home.every((e) => e.startDate.isDate)).toBe(true);
  });

  it("shows commute flights from what's already looked up", () => {
    const t = pack().lines[0].trips[0];
    const answer: TravelAnswer = {
      id: `${travelKey(t)}:toBase`,
      tripId: travelKey(t),
      kind: "toBase",
      options: 3,
      jumpseatWays: 1,
      departures: [Date.UTC(2026, 8, 29, 13), Date.UTC(2026, 8, 29, 16), Date.UTC(2026, 8, 29, 19)],
      lastDeparture: Date.UTC(2026, 8, 29, 19),
      firstArrival: null,
      best: [
        { n: "AS 608", from: "SAN", to: "SEA", dep: Date.UTC(2026, 8, 29, 13), arr: Date.UTC(2026, 8, 29, 16) },
        { n: "FX 100", from: "SEA", to: "MEM", dep: Date.UTC(2026, 8, 29, 18), arr: Date.UTC(2026, 8, 29, 22), jumpseat: true },
      ],
      window: [0, 1],
    };
    const ev = parsed(renderFeed([month({ flights: { [answer.id]: answer } })], { homeDays: false })).find((e) => e.summary.startsWith("Trip 27"))!;
    expect(ev.description).toContain("Commute in: SAN > SEA > MEM, AS 608 + FX 100 (jumpseat): leaves Tue Sep 29 06:00, lands Tue Sep 29 17:00 (2 others to fall back on)");
  });

  it("never shows another pilot: only this pack's line, and the seniority list isn't touched", () => {
    const ics = renderFeed([month({}, pack({ seniorityList: [{ bidNumber: 1, seniority: 987654 }] }))], { homeDays: true });
    expect(ics).not.toContain("987654");
    expect(ics).not.toContain("1005");
  });

  it("leaves trips out when there's no line, but still has the timeline", () => {
    const none = month({ lineNumber: null, lineSource: null });
    expect(none.trips).toEqual([]);
    expect(parsed(renderFeed([none], { homeDays: true })).map((e) => e.summary)).toContain("OCT26 bid closes");
    // A line number this pack doesn't have (a reserve line, say) is the same.
    expect(month({ lineNumber: "7014" }).trips).toEqual([]);
  });

  it("is never empty: a calendar has to hold something, and it says what to do", () => {
    const ics = renderFeed([], { homeDays: false }, Date.UTC(2026, 10, 8, 19));
    expectValid(ics);
    const events = parsed(ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain("open My Rankings");
    expect(events[0].startDate.toString()).toBe("2026-11-08");
    expect(events[0].startDate.isDate).toBe(true);
    // It goes as soon as there's anything real.
    expect(parsed(renderFeed([month()], { homeDays: false })).some((e) => e.uid === "waiting@lineselect")).toBe(false);
  });

  it("skips a trip with no grid-confirmed date rather than guessing one", () => {
    const m = month({}, pack({ lines: [line({ trips: [trip({ startDayIndex: null })] })] }));
    expect(m.trips).toEqual([]);
  });
});

describe("stable events", () => {
  const uids = (ics: string) => parsed(ics).map((e) => e.uid);

  it("reads back byte for byte the same when nothing changed", () => {
    expect(renderFeed([month()], { homeDays: true })).toBe(renderFeed([month()], { homeDays: true }));
  });

  it("keeps the same UIDs across rebuilds at different times", () => {
    expect(uids(renderFeed([month({ now: NOW + 86_400_000 })], { homeDays: true }))).toEqual(uids(renderFeed([month()], { homeDays: true })));
  });

  it("keeps one event for a trip that the old #1 and the new #1 share", () => {
    const before = uids(renderFeed([month()], { homeDays: false }));
    const after = uids(renderFeed([month({ lineNumber: "1005", now: NOW + 1 })], { homeDays: false }));
    expect(after.filter((u) => u.startsWith("trip-"))).toContain("trip-OCT26-27-20260930@lineselect");
    expect(before).toContain("trip-OCT26-27-20260930@lineselect");
    expect(after).not.toContain("trip-OCT26-31-20261008@lineselect");
    expect(before).toContain("trip-OCT26-31-20261008@lineselect");
  });

  it("gives a captain and first officer different timeline events", () => {
    const fo = uids(renderFeed([month({}, pack({ seat: "FO" }))], { homeDays: false })).filter((u) => u.startsWith("bid-"));
    expect(fo.every((u) => u.includes("-FO-"))).toBe(true);
  });
});

describe("keeping months", () => {
  const nextPack = () => pack({ id: "NOV26-MEM-MD11-CAP", month: "NOV26", bidPeriodStart: "2026-10-26" });

  it("keeps the month being flown when the next pack arrives", () => {
    const flying = month({ lineSource: "awarded" });
    const next = buildFeedMonth(nextPack(), { lineNumber: "1005", lineSource: "top", now: NOW + 1000 });
    const months = withFeedMonth([flying], next);
    const titles = parsed(renderFeed(months, { homeDays: false })).map((e) => e.summary);
    expect(months.map((m) => m.month).sort()).toEqual(["NOV26", "OCT26"]);
    expect(titles.some((t) => t.startsWith("Trip 27") && !t.includes("#1"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Trip 99"))).toBe(true);
  });

  it("replaces a month's earlier build, and doesn't grow without end", () => {
    expect(withFeedMonth([month()], month({ lineNumber: "1005" }))).toHaveLength(1);
    const many = ["JAN27", "FEB27", "MAR27", "APR27", "MAY27"].reduce<FeedMonth[]>(
      (acc, m, i) => withFeedMonth(acc, { ...month(), month: m, trips: [], timeline: [], builtAt: NOW + i }),
      []
    );
    expect(many.map((m) => m.month)).toEqual(["MAY27", "APR27", "MAR27"]);
  });

  it("shows one event when two months print the same bid's dates, the newest build winning", () => {
    const older = month();
    const nov = month({ now: NOW + 5000 }, nextPack());
    const ics = renderFeed([older, nov], { homeDays: false });
    expectValid(ics);
    const count = parsed(ics).filter((e) => e.uid === "bid-NOV26-CAP-bid-close@lineselect");
    expect(count).toHaveLength(1);
  });
});

describe("on a real pack", () => {
  const dir = ".cache/packs";
  const file = `${dir}/OCT26-MEM-MD11-FO.json`;
  it.skipIf(!fs.existsSync(file))("every placed line of a real pack renders valid, and days off never land on a trip", () => {
    const real = expandBidPack(JSON.parse(fs.readFileSync(file, "utf8")));
    for (const l of real.lines.filter((x) => !x.estimated).slice(0, 40)) {
      const m = buildFeedMonth({ ...real, bidCalendar }, { lineNumber: l.lineNumber, lineSource: "awarded", now: NOW });
      const ics = renderFeed([m], { homeDays: true });
      expectValid(ics);
      expect(parsed(ics).length).toBeGreaterThan(0);
      const placed = l.trips.filter((t) => t.startDayIndex !== null);
      expect(m.trips.length).toBe(placed.filter((t) => t.schedule.length > 0).length);
      for (const t of placed) expect(l.gridOffDays ?? []).not.toContain(t.startDayIndex);
    }
  });
});
