import { existsSync, readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreBidPack } from "@/lib/bidpack-storage";
import {
  canCheckCommute,
  commuteBlocks,
  commuteBlockWords,
  commuteNeedsForPack,
  commuteStatuses,
  commuteStatusOfLine,
  landsOnReleaseDay,
  leavesOnReportDay,
  loadCommuteAnswers,
  runCommuteCheck,
  type CommuteAnswers,
  type CommuteSettings,
} from "@/lib/commute-filter";
import { travelNeedsForPack } from "@/lib/flights/needs";
import type { BidPack, Line, Trip, TripLeg } from "@/types/bidpack";

// October's packs are the real shape of everything this reads; they aren't in the repository.
const PACKS_DIR = ".cache/packs";
const seats = existsSync(PACKS_DIR) ? readdirSync(PACKS_DIR).filter((f) => f.startsWith("OCT26") && f.endsWith(".json")) : [];
const load = (file: string): BidPack => restoreBidPack(JSON.parse(readFileSync(`${PACKS_DIR}/${file}`, "utf8")));

const SETTINGS: CommuteSettings = { homeAirport: "DEN", arriveBeforeReportHours: 2, releaseToDepartureHours: 1, jumpseats: true };
const BEFORE_OCT = Date.parse("2026-09-01T00:00:00Z");

describe("canCheckCommute", () => {
  it("wants a real airport that isn't the base", () => {
    expect(canCheckCommute({ base: "MEM" }, "DEN")).toBe(true);
    expect(canCheckCommute({ base: "MEM" }, "MEM")).toBe(false);
    expect(canCheckCommute({ base: "MEM" }, "DE")).toBe(false);
    expect(canCheckCommute({ base: "MEM" }, "ZZZ")).toBe(false);
    expect(canCheckCommute({ base: "MEM" }, "")).toBe(false);
  });
});

describe("runCommuteCheck", () => {
  const pack: BidPack = seats.length ? load(seats.find((s) => s.includes("MD11-CAP")) ?? seats[0]) : ({} as BidPack);
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("window", { localStorage: new Proxy(localStorage, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }) });
  });

  const answering = (over: (body: { needs: { id: string; tripId: string; kind: string }[] }) => Response | null = () => null) =>
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { needs: { id: string; tripId: string; kind: string }[]; jumpseats: unknown[] };
      const special = over(body);
      if (special) return special;
      return new Response(JSON.stringify({ configured: true, answers: body.needs.map((n) => ({ id: n.id, tripId: n.tripId, kind: n.kind, lastDeparture: 1, firstArrival: 1 })) }));
    }) as unknown as typeof fetch;

  it.skipIf(!seats.length)("asks each question once, and nothing it already has on a second run", async () => {
    const fetcher = answering();
    const needs = commuteNeedsForPack(pack, SETTINGS, BEFORE_OCT);
    expect(new Set(needs.map((n) => n.id)).size).toBe(needs.length);
    expect(await runCommuteCheck(pack, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher })).toBe("done");
    const calls = vi.mocked(fetcher).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(await runCommuteCheck(pack, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher })).toBe("done");
    expect(vi.mocked(fetcher).mock.calls.length).toBe(calls);
    expect(Object.keys(loadCommuteAnswers(pack.id, SETTINGS, BEFORE_OCT)).length).toBe(needs.length);
  });

  it.skipIf(!seats.length)("stops at a limit and keeps what it had, and says when flight data isn't set up", async () => {
    let first = true;
    const limited = answering(() => {
      if (first) {
        first = false;
        return null;
      }
      return new Response("{}", { status: 429 });
    });
    const big: BidPack = load(seats.find((s) => s.includes("MEM-B777-FO")) ?? seats[0]);
    const end = await runCommuteCheck(big, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher: limited });
    const kept = Object.keys(loadCommuteAnswers(big.id, SETTINGS, BEFORE_OCT)).length;
    if (commuteNeedsForPack(big, SETTINGS, BEFORE_OCT).length > 500) {
      expect(end).toBe("paused");
      expect(kept).toBe(500);
    }
    const off = vi.fn(async () => new Response(JSON.stringify({ configured: false, answers: [] }))) as unknown as typeof fetch;
    expect(await runCommuteCheck(pack, { ...SETTINGS, homeAirport: "SEA" }, () => {}, { now: BEFORE_OCT, fetcher: off })).toBe("unavailable");
  });

  it.skipIf(!seats.length)("keeps a partial answer's word only for a yes, and asks it again next run", async () => {
    const partial = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { needs: { id: string; tripId: string; kind: string }[] };
      return new Response(JSON.stringify({ configured: true, partial: true, answers: body.needs.map((n) => ({ id: n.id, tripId: n.tripId, kind: n.kind, lastDeparture: null, firstArrival: null })) }));
    }) as unknown as typeof fetch;
    await runCommuteCheck(pack, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher: partial });
    const kept = loadCommuteAnswers(pack.id, SETTINGS, BEFORE_OCT);
    expect(Object.values(kept).every((a) => a.partial)).toBe(true);
    const calls = vi.mocked(partial).mock.calls.length;
    await runCommuteCheck(pack, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher: partial });
    expect(vi.mocked(partial).mock.calls.length).toBe(calls * 2);
  });

  it.skipIf(!seats.length)("sends jumpseats only when they count", async () => {
    const bodies: { jumpseats: unknown[] }[] = [];
    const fetcher = vi.fn(async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ configured: true, answers: [] }));
    }) as unknown as typeof fetch;
    await runCommuteCheck(pack, { ...SETTINGS, jumpseats: false }, () => {}, { now: BEFORE_OCT, fetcher });
    expect(bodies.every((b) => b.jumpseats.length === 0)).toBe(true);
    bodies.length = 0;
    await runCommuteCheck(pack, SETTINGS, () => {}, { now: BEFORE_OCT, fetcher });
    expect(bodies.some((b) => b.jumpseats.length > 0)).toBe(true);
  });
});

describe.skipIf(!seats.length)("commute status on the October seats", () => {
  it.each(seats)("%s", (file) => {
    const pack = load(file);
    const base = pack.base;
    const home = base === "DEN" ? "SEA" : "DEN";
    const s = { ...SETTINGS, homeAirport: home };
    const needs = commuteNeedsForPack(pack, s, BEFORE_OCT);
    // Trips flown back to back ask nothing between them, so it never asks more than every trip would.
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.length).toBeLessThanOrEqual(travelNeedsForPack(pack, { homeAirports: [home], commuteBufferHours: 2, frontBufferHours: 2, backRestHours: 1 }).length);

    // With nothing answered, nothing is ruled out: unknown, never a guess.
    const none = commuteStatuses(pack, s, {}, BEFORE_OCT);
    expect([...none.values()].every((v) => v === "unknown")).toBe(true);

    // With every flight on the day, every line that isn't an estimate works.
    const ok: CommuteAnswers = {};
    for (const n of needs) {
      const onDay = n.kind === "toBase" || n.kind === "deviateOut" ? n.arriveBy! - 1 : n.departAfter + 1;
      ok[n.id] = { lastDeparture: onDay, firstArrival: onDay };
    }
    const yes = commuteStatuses(pack, s, ok, BEFORE_OCT);
    const worked = pack.lines.filter((l) => yes.get(l.id) === "yes").length;
    expect(worked).toBeGreaterThan(0);

    // With no flights at all, every line that has a commute to make can't be commuted.
    const nothing: CommuteAnswers = {};
    for (const n of needs) nothing[n.id] = { lastDeparture: null, firstArrival: null };
    const no = commuteStatuses(pack, s, nothing, BEFORE_OCT);
    for (const l of pack.lines) if (l.estimated) expect(no.get(l.id)).toBe("unknown");
    expect([...no.values()].filter((v) => v === "yes").length).toBe(0);
    expect([...no.values()].filter((v) => v === "no").length).toBeGreaterThan(0);
  }, 60_000);

  it("rules out a line when one end is a real no, and stays unknown while the rest aren't in", () => {
    const pack = load(seats[0]);
    const line = pack.lines.find((l): l is Line => !l.estimated && l.trips.length >= 2)!;
    const s = { ...SETTINGS, homeAirport: pack.base === "DEN" ? "SEA" : "DEN" };
    const needs = commuteNeedsForPack({ ...pack, lines: [line] }, s, BEFORE_OCT);
    const firstIn = needs.filter((n) => n.kind === "toBase" || n.kind === "deviateOut");
    const tripOne = firstIn[0].tripId;
    const blocked: CommuteAnswers = Object.fromEntries(firstIn.filter((n) => n.tripId === tripOne).map((n) => [n.id, { lastDeparture: null, firstArrival: null }]));
    expect(commuteStatusOfLine(line, pack, s, blocked, BEFORE_OCT)).toBe("no");
    expect(commuteStatusOfLine(line, pack, s, {}, BEFORE_OCT)).toBe("unknown");
  });

  it("doesn't count trips already flown", () => {
    const pack = load(seats[0]);
    const line = pack.lines.find((l) => !l.estimated && l.trips.length > 0)!;
    const s = { ...SETTINGS, homeAirport: pack.base === "DEN" ? "SEA" : "DEN" };
    const afterwards = Date.parse("2027-06-01T00:00:00Z");
    expect(commuteNeedsForPack(pack, s, afterwards)).toEqual([]);
    expect(commuteStatusOfLine(line, pack, s, {}, afterwards)).toBe("unknown");
  });
});

describe("whose day a time belongs to", () => {
  const home = "America/Denver";
  const base = "America/Chicago";
  const ct = (t: string) => Date.parse(`2026-10-${t}-05:00`);
  const mt = (t: string) => Date.parse(`2026-10-${t}-06:00`);

  it("takes the evening before for a report in the small hours, and not for a morning one", () => {
    expect(leavesOnReportDay(mt("13T19:00:00"), ct("14T02:00:00"), home, base)).toBe(true);
    expect(leavesOnReportDay(mt("13T19:00:00"), ct("14T08:00:00"), home, base)).toBe(false);
    expect(leavesOnReportDay(mt("14T06:00:00"), ct("14T08:00:00"), home, base)).toBe(true);
  });

  it("goes by the pack's date for the report, whatever the clock says at home", () => {
    // 05:30 Tuesday in Memphis is 04:30 in Denver, but it's a Tuesday report: Monday evening's flight means a night at base.
    expect(leavesOnReportDay(mt("13T19:00:00"), ct("14T05:30:00"), home, base)).toBe(false);
  });

  it("counts landing home just past midnight, and the morning after a small-hours release, but not the next day", () => {
    expect(landsOnReleaseDay(mt("15T00:40:00"), ct("14T22:00:00"), home, base)).toBe(true);
    expect(landsOnReleaseDay(mt("15T09:00:00"), ct("14T22:00:00"), home, base)).toBe(false);
    expect(landsOnReleaseDay(mt("14T10:00:00"), ct("14T02:30:00"), home, base)).toBe(true);
  });

  it("goes by the pack's date for the release: 00:39 in Memphis is that day, though it's still yesterday in Denver", () => {
    expect(landsOnReleaseDay(mt("15T07:45:00"), ct("15T00:39:00"), home, base)).toBe(true);
    expect(landsOnReleaseDay(mt("15T07:45:00"), ct("14T23:56:00"), home, base)).toBe(false);
  });

  it("counts a flight just after a release or before a report in the small hours, with the same day on both sides", () => {
    // Released 00:02 in Memphis and home at 02:02: the release's own day, though the clock at home is still last night.
    expect(landsOnReleaseDay(mt("13T02:02:00"), ct("13T00:02:00"), home, base)).toBe(true);
    // Leaving home at 00:15 for a 04:30 report: the night before that report, so no night at base.
    expect(leavesOnReportDay(mt("14T00:15:00"), ct("14T04:30:00"), home, base)).toBe(true);
  });

  it("keeps 05:00 at 05:00 across a daylight-saving change", () => {
    const at = (iso: string) => Date.parse(iso);
    // 2026-11-01, clocks go back: a 04:30 landing after an Oct 31 release is still that night, as it is a week later.
    expect(landsOnReleaseDay(at("2026-11-01T04:30:00-07:00"), at("2026-10-31T22:00:00-05:00"), home, base)).toBe(true);
    expect(landsOnReleaseDay(at("2026-11-08T04:30:00-07:00"), at("2026-11-07T22:00:00-06:00"), home, base)).toBe(true);
    // 2027-03-14, clocks go forward: a 05:30 report is a morning report, as it is a week later.
    expect(leavesOnReportDay(at("2027-03-13T19:00:00-07:00"), at("2027-03-14T05:30:00-05:00"), home, base)).toBe(false);
    expect(leavesOnReportDay(at("2027-03-20T19:00:00-06:00"), at("2027-03-21T05:30:00-05:00"), home, base)).toBe(false);
  });
});

describe.skipIf(!seats.length)("each way is asked about its own day", () => {
  const pack = seats.length ? load(seats.find((f) => f.includes("MD11-CAP")) ?? seats[0]) : ({} as BidPack);
  const s = { ...SETTINGS, homeAirport: "DEN" };
  const needs = seats.length ? commuteNeedsForPack(pack, s, BEFORE_OCT) : [];

  it("asks about the day alone, never the evening before a morning report", () => {
    for (const n of needs.filter((x) => x.kind === "toBase" || x.kind === "deviateOut")) {
      expect(n.departBefore).toBe(n.arriveBy);
      // Opening at midnight on the clock at home, and a window the server will take.
      expect(new Date(n.departAfter).toLocaleTimeString("en-US", { timeZone: "America/Denver", hour12: false }).startsWith("24:00") || new Date(n.departAfter).toLocaleTimeString("en-US", { timeZone: "America/Denver", hour12: false }).startsWith("00:00")).toBe(true);
      expect(n.departBefore - n.departAfter).toBeLessThanOrEqual(48 * 3_600_000);
      expect(n.departBefore).toBeGreaterThan(n.departAfter);
    }
    for (const n of needs.filter((x) => x.kind === "homeFromBase" || x.kind === "deviateHome")) {
      expect(n.departBefore).toBeGreaterThan(n.departAfter);
      expect(n.departBefore - n.departAfter).toBeLessThanOrEqual(48 * 3_600_000);
    }
  });

  it("lets a deviation stand on its own day, not the trip's report", () => {
    const deviating = pack.lines.find((l) => l.trips.length === 1 && !l.estimated && needs.some((n) => n.kind === "deviateOut" && n.tripId.startsWith(l.trips[0].id)));
    if (!deviating) return;
    const own = commuteNeedsForPack({ ...pack, lines: [deviating] }, s, BEFORE_OCT);
    const answers: CommuteAnswers = {};
    for (const n of own) {
      answers[n.id] =
        n.kind === "deviateOut"
          ? { lastDeparture: n.arriveBy! - 3_600_000, firstArrival: null }
          : n.kind === "toBase"
            ? { lastDeparture: null, firstArrival: null }
            : { lastDeparture: null, firstArrival: n.departAfter + 3_600_000 };
    }
    // Commuting to base can't be done, but the deadhead can be caught from home on the day its flying starts.
    expect(commuteStatusOfLine(deviating, pack, s, answers, BEFORE_OCT)).not.toBe("no");
  });

  it("won't rule a line out on answers given while boards were held back, and asks them again", async () => {
    const line = pack.lines.find((l) => !l.estimated && l.trips.length > 0)!;
    const own = commuteNeedsForPack({ ...pack, lines: [line] }, s, BEFORE_OCT);
    const held: CommuteAnswers = Object.fromEntries(own.map((n) => [n.id, { lastDeparture: null, firstArrival: null, partial: true as const }]));
    expect(commuteStatusOfLine(line, pack, s, held, BEFORE_OCT)).toBe("unknown");
    const whole: CommuteAnswers = Object.fromEntries(own.map((n) => [n.id, { lastDeparture: null, firstArrival: null }]));
    expect(commuteStatusOfLine(line, pack, s, whole, BEFORE_OCT)).toBe("no");
  });
});

describe("a trip running into the next month", () => {
  const leg = (fn: string, from: string, to: string, start: number, end: number): TripLeg => ({
    flightNumber: fn, equipment: "77", isDeadhead: false, depAirport: from, arrAirport: to, depTimeLocal: "0000", depTimeGmt: "0000",
    arrTimeLocal: "0000", arrTimeGmt: "0000", blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  });
  // Reports Sat Oct 24 at 10:00 in Memphis and lands back Mon Oct 26 at 20:00, after the bid month ended at midnight.
  const trip: Trip = {
    id: "t9", pairingNumber: "909", days: 3, layoverCities: ["OAK"], layoverDetails: [], reportTime: "early", international: false,
    deadheadLegs: 0, creditHours: 12, landings: 2, tafbHours: 58, departures: 2, zuluAnchor: "", startDayIndex: 26,
    schedule: [
      { reportTimeLocal: "1000", startMinutes: 0, legs: [leg("501", "MEM", "OAK", 60, 360)], layover: { city: "OAK", hotelName: null, transportToHotel: null, transportFromHotel: null, hours: 40, startMinutes: 360, endMinutes: 2760 } },
      { reportTimeLocal: "0800", startMinutes: 3120, legs: [leg("502", "OAK", "MEM", 3180, 3480)], layover: null },
    ],
  };
  const line: Line = { id: "L9", lineNumber: "1009", trips: [trip], daysOff: 25, totalCreditHours: 12, totalTafbHours: 58, totalLandings: 2, totalDepartures: 2 };
  const pack = { id: "p9", month: "OCT26", base: "MEM", aircraft: "B777", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;

  it("is judged on getting in this month, and leaves the way home to the month it's in", () => {
    const needs = commuteNeedsForPack(pack, SETTINGS, BEFORE_OCT);
    expect(needs.map((n) => n.kind)).toEqual(["toBase"]);
    // Getting in works; nothing gets the pilot home on Oct 26, but that's November's commute.
    const answers: CommuteAnswers = {
      "t9@26:toBase": { lastDeparture: needs[0].arriveBy! - 3_600_000, firstArrival: null },
      "t9@26:homeFromBase": { lastDeparture: null, firstArrival: null },
    };
    expect(commuteStatusOfLine(line, pack, SETTINGS, answers, BEFORE_OCT)).toBe("yes");
  });
});

describe("trips the pilot flies back to back", () => {
  const leg = (fn: string, from: string, to: string, start: number, end: number): TripLeg => ({
    flightNumber: fn, equipment: "77", isDeadhead: false, depAirport: from, arrAirport: to, depTimeLocal: "0000", depTimeGmt: "0000",
    arrTimeLocal: "0000", arrTimeGmt: "0000", blockHours: (end - start) / 60, startMinutes: start, endMinutes: end, depTimeZulu: "", arrTimeZulu: "",
  });
  // Day trips out of Memphis on Mon Oct 5 and Wed Oct 7, both reporting at 10:00: about a day and a half at home between.
  const dayTrip = (id: string, startDayIndex: number): Trip => ({
    id, pairingNumber: id, days: 1, layoverCities: [], layoverDetails: [], reportTime: "early", international: false,
    deadheadLegs: 0, creditHours: 6, landings: 2, tafbHours: 6.5, departures: 2, zuluAnchor: "", startDayIndex,
    schedule: [{ reportTimeLocal: "1000", startMinutes: 0, legs: [leg("601", "MEM", "IND", 60, 150), leg("602", "IND", "MEM", 210, 300)], layover: null }],
  });
  const line: Line = { id: "L8", lineNumber: "1008", trips: [dayTrip("a", 7), dayTrip("b", 9)], daysOff: 26, totalCreditHours: 12, totalTafbHours: 13, totalLandings: 4, totalDepartures: 4 };
  const pack = { id: "p8", month: "OCT26", base: "MEM", aircraft: "B777", seat: "FO", bidPeriodDays: 28, bidPeriodStart: "2026-09-28", lines: [line] } as unknown as BidPack;
  // In for the first and home after the second work; home between them and back in for the second don't.
  const answers: CommuteAnswers = {
    "a@7:toBase": { lastDeparture: null, firstArrival: null },
    "a@7:homeFromBase": { lastDeparture: null, firstArrival: null },
    "b@9:toBase": { lastDeparture: null, firstArrival: null },
    "b@9:homeFromBase": { lastDeparture: null, firstArrival: null },
  };
  for (const n of commuteNeedsForPack(pack, SETTINGS, BEFORE_OCT)) {
    if (n.id === "a@7:toBase") answers[n.id] = { lastDeparture: n.arriveBy! - 3_600_000, firstArrival: null };
    if (n.id === "b@9:homeFromBase") answers[n.id] = { lastDeparture: null, firstArrival: n.departAfter + 3 * 3_600_000 };
  }

  it("go home between them only with the hours at home the pilot wants", () => {
    // A day and a half is enough for most: two departures, and the commute home between them can't be done.
    expect(commuteStatusOfLine(line, pack, SETTINGS, answers, BEFORE_OCT)).toBe("no");
    // Wanting two days at home before going, the pilot stays at base: one departure, in once and home once.
    const stays = { ...SETTINGS, minHomeHours: 48 };
    expect(commuteNeedsForPack(pack, stays, BEFORE_OCT).map((n) => n.id).sort()).toEqual(["a@7:toBase", "b@9:homeFromBase"]);
    expect(commuteStatusOfLine(line, pack, stays, answers, BEFORE_OCT)).toBe("yes");
  });

  it("says which end of which trip rules a line out", () => {
    const out = commuteBlocks(pack, SETTINGS, answers, BEFORE_OCT);
    expect(out.map((o) => o.line.lineNumber)).toEqual(["1008"]);
    expect(commuteBlockWords(out[0].block, pack)).toBe("Trip a: nothing gets you home the day it ends (lands Mon Oct 5 15:00).");
    expect(commuteBlocks(pack, { ...SETTINGS, minHomeHours: 48 }, answers, BEFORE_OCT)).toEqual([]);
  });
});

describe.skipIf(!seats.length)("what the commute filter asks", () => {
  it("allows a wider detour on every question, and within what the route takes", () => {
    const needs = commuteNeedsForPack(load(seats[0]), SETTINGS, BEFORE_OCT);
    expect(needs.length).toBeGreaterThan(0);
    for (const n of needs) {
      expect(n.maxDetour).toBeGreaterThanOrEqual(1);
      expect(n.maxDetour).toBeLessThanOrEqual(2);
    }
  });
});
