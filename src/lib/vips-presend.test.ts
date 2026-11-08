import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { buildLineFeatures } from "@/lib/forecast/features";
import { forecastBid, forecastFromFeatures, forecastPackKey, type BidForecast } from "@/lib/forecast/forecast";
import { rankReserveLines } from "@/lib/reserve-rank";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { LineScore } from "@/lib/scoring";
import { deriveSeniorityInput } from "@/lib/seniority-derive";
import { expectedGone, fullBidOrder, meetsDaysOffBlocks, recommendedCatchAlls, runPresendChecks, vipsQuestionNotes, type PresendCheck, type PresendInput } from "@/lib/vips-presend";
import type { BidPack, SeniorityEntry } from "@/types/bidpack";

const NOW = new Date("2026-09-05T12:00:00Z");

/** The sample pack's 6 lines as a real pack would be: a future bid period and one pilot per place on its list. */
function packWith(pilots: number, overrides: Partial<BidPack> = {}, pay: number[] = []): BidPack {
  const seniorityList: SeniorityEntry[] = Array.from({ length: pilots }, (_, i) => ({ bidNumber: i + 1, seniority: 1000 + i, ...(pay.includes(i + 1) ? { pay: true } : {}) }));
  return { ...SAMPLE_BID_PACK, id: "real-pack", month: "OCT26", bidPeriodStart: "2026-09-28", bidPeriodDays: 28, seniorityList, ...overrides };
}

/** A forecast with no chance in it: nobody ahead passes on a line, so what's left is simple counting. */
function exactForecast(pack: BidPack, myBidNumber: number, listed?: number): BidForecast {
  const features = buildLineFeatures(pack);
  return forecastFromFeatures({
    packKey: forecastPackKey(pack),
    features,
    seniorityList: pack.seniorityList!,
    regularLines: pack.lines.length,
    dropoutRate: 0,
    seniorityNumber: 1000 + myBidNumber - 1,
    myRanking: features.lineIds.map((_, i) => i).slice(0, listed),
    known: [],
    simulations: 200,
  });
}

function input(pack: BidPack, over: Partial<PresendInput> = {}): PresendInput {
  return {
    bidPack: pack,
    lineNumbers: pack.lines.map((l) => l.lineNumber),
    leftOut: 0,
    lineScores: [],
    seniority: null,
    forecast: null,
    reserveLines: rankReserveLines(pack, {}),
    anyLines: [],
    reserveLinesAdded: false,
    close: null,
    now: NOW,
    ...over,
  };
}

const byId = (checks: PresendCheck[], id: string) => checks.find((c) => c.id === id);

describe("could you run out: hand-worked on a 6-line pack", () => {
  it("first to bid: every line open, nothing gone", () => {
    const pack = packWith(20);
    const f = exactForecast(pack, 1);
    expect(f.pilotsAhead).toBe(0);
    expect(expectedGone(f, pack, pack.lines.map((l) => l.lineNumber))).toBeCloseTo(0);
    expect(f.pNoRegularLine).toBe(0);
  });

  it("4th to bid: 3 pilots ahead take 3 of the 6 lines, whichever they are", () => {
    const pack = packWith(20);
    const f = exactForecast(pack, 4);
    expect(f.pilotsAhead).toBe(3);
    expect(expectedGone(f, pack, pack.lines.map((l) => l.lineNumber))).toBeCloseTo(3);
    expect(f.pNoRegularLine).toBe(0);
  });

  it("7th to bid: 6 pilots ahead take all 6, and the message says so", () => {
    const pack = packWith(20);
    const f = exactForecast(pack, 7);
    expect(expectedGone(f, pack, pack.lines.map((l) => l.lineNumber))).toBeCloseTo(6);
    expect(f.pNoRegularLine).toBe(1);
    const check = byId(runPresendChecks(input(pack, { forecast: f })), "run-out")!;
    expect(check.level).toBe("warn");
    expect(check.message).toContain("6 pilots bid before you");
    expect(check.message).toContain("All 6 lines");
    expect(check.message).toContain("Expect none to be left");
    expect(check.message).toContain("25.C.2–3");
  });

  it("pilots marked PAY ahead take nothing: 7th with 2 PAY ahead has 4 real bidders ahead", () => {
    const pack = packWith(20, {}, [1, 2]);
    const f = exactForecast(pack, 7);
    expect(f.pilotsAhead).toBe(4);
    expect(expectedGone(f, pack, pack.lines.map((l) => l.lineNumber))).toBeCloseTo(4);
    expect(f.pNoRegularLine).toBe(0);
  });

  it("a short list runs out sooner: the same 3 pilots ahead can take all 3 lines listed, never all 4", () => {
    const pack = packWith(20);
    expect(exactForecast(pack, 4, 3).pNoRegularLine).toBeGreaterThan(0);
    expect(exactForecast(pack, 4, 4).pNoRegularLine).toBe(0);
  });

  it("a catch-all answers the warning", () => {
    const pack = packWith(20);
    const check = byId(runPresendChecks(input(pack, { forecast: exactForecast(pack, 7), anyLines: ["secondary"] })), "run-out")!;
    expect(check.level).toBe("info");
    expect(check.message).toContain("catch-all covers that");
  });

  it("offers adding lines only when there are lines left to add", () => {
    const pack = packWith(20);
    const forecast = exactForecast(pack, 7);
    expect(byId(runPresendChecks(input(pack, { forecast, leftOut: 2 })), "run-out")!.message).toContain("Add more lines");
    expect(byId(runPresendChecks(input(pack, { forecast })), "run-out")!.message).not.toContain("Add more lines");
  });

  it("with no seniority number, says how to add it", () => {
    const check = byId(runPresendChecks(input(packWith(20))), "run-out")!;
    expect(check.level).toBe("info");
    expect(check.message).toContain("Add your seniority number");
    expect(check.fix).toEqual({ kind: "link", label: "Add it on Preferences", href: "/preferences" });
  });

  it("with no list in the pack, says it can't tell", () => {
    expect(byId(runPresendChecks(input(packWith(0, { seniorityList: undefined }))), "run-out")!.message).toContain("no seniority list");
  });
});

describe("catch-all advice", () => {
  const pack = (info: { regular: number; secondary: number; reserve: number }) =>
    packWith(30, { info: { ...SAMPLE_BID_PACK.info!, totalRegularLines: info.regular, totalSecondaryLines: info.secondary, totalReserveLines: info.reserve } });
  const sizes = { regular: 6, secondary: 4, reserve: 6 };

  it("needs 9950 only when the list leaves lines out", () => {
    expect(recommendedCatchAlls(0)).toEqual(["secondary", "reserve"]);
    expect(recommendedCatchAlls(3)).toEqual(["regular", "secondary", "reserve"]);
  });

  it("a pilot inside the regular lines gets a quiet note, without reserve lines", () => {
    const check = byId(runPresendChecks(input(pack(sizes), { seniority: { rank: 2, totalPilots: 30 }, forecast: exactForecast(pack(sizes), 2) })), "catch-all")!;
    expect(check.level).toBe("info");
    expect(check.message).toContain("holds a regular line");
    expect(check.fix).toMatchObject({ kind: "catch-all", anyLines: ["secondary", "reserve"], reserveLines: [] });
  });

  it("a pilot on the secondary lines is warned", () => {
    const check = byId(runPresendChecks(input(pack(sizes), { seniority: { rank: 8, totalPilots: 30 } })), "catch-all")!;
    expect(check.level).toBe("warn");
    expect(check.message).toContain("secondary line");
  });

  it("a pilot on reserve is given named reserve lines in their own order", () => {
    const p = pack(sizes);
    const check = byId(runPresendChecks(input(p, { seniority: { rank: 15, totalPilots: 30 } })), "catch-all")!;
    expect(check.level).toBe("warn");
    expect(check.message).toContain("lands on a reserve line");
    expect(check.fix).toMatchObject({ reserveLines: rankReserveLines(p, {}).map((l) => l.lineNumber) });
  });

  it("goes quiet once the pilot has done it", () => {
    const p = pack(sizes);
    const done = input(p, { seniority: { rank: 15, totalPilots: 30 }, anyLines: ["secondary", "reserve"], reserveLinesAdded: true });
    expect(byId(runPresendChecks(done), "catch-all")).toBeUndefined();
  });

  it("puts named reserve lines between the secondary and reserve catch-alls", () => {
    expect(fullBidOrder(["1", "2"], ["regular", "secondary", "reserve"], ["7001", "7002"])).toEqual(["1", "2", "9950", "9952", "7001", "7002", "9954"]);
    expect(fullBidOrder(["1"], [], [])).toEqual(["1"]);
  });
});

describe("what the contract limits (CBA 2026 25.D.1)", () => {
  it("reads days-off blocks that may be combined: a 4-week period needs 4 + 3 + 2", () => {
    expect(meetsDaysOffBlocks([4, 3, 2], 1)).toBe(true);
    expect(meetsDaysOffBlocks([9], 1)).toBe(true);
    expect(meetsDaysOffBlocks([7, 2], 1)).toBe(true);
    expect(meetsDaysOffBlocks([3, 3, 3], 1)).toBe(false);
    expect(meetsDaysOffBlocks([4, 2, 2], 1)).toBe(false);
  });

  it("a 5-week period needs 4 + 3 + 3 + 2", () => {
    expect(meetsDaysOffBlocks([4, 3, 3, 2], 2)).toBe(true);
    expect(meetsDaysOffBlocks([4, 3, 2], 2)).toBe(false);
  });

  it("flags a line over the TAFB cap as a likely misread, quoting the section", () => {
    const pack = packWith(20);
    const odd = { ...pack, lines: pack.lines.map((l, i) => (i === 0 ? { ...l, totalTafbHours: 340 } : l)) };
    const check = byId(runPresendChecks(input(odd)), "construction")!;
    expect(check.level).toBe("warn");
    expect(check.message).toContain("340 h");
    expect(check.message).toContain("25.D.1.b");
    expect(check.message).toContain("misread");
  });

  it("flags too many work days", () => {
    const pack = packWith(20);
    const odd = { ...pack, lines: pack.lines.map((l, i) => (i === 0 ? { ...l, daysOff: 10 } : l)) };
    expect(byId(runPresendChecks(input(odd)), "construction")!.message).toContain("18 work days");
  });
});

describe("wrong pack, wrong time", () => {
  it("stops on the sample pack", () => {
    const check = byId(runPresendChecks(input({ ...packWith(20), id: SAMPLE_BID_PACK.id })), "sample-pack")!;
    expect(check.level).toBe("stop");
  });

  it("stops when the bid period has started", () => {
    const check = byId(runPresendChecks(input(packWith(20), { now: new Date("2026-10-02T00:00:00Z") })), "period-started")!;
    expect(check.level).toBe("stop");
  });

  it("reads the period from the month code when the pack printed no date", () => {
    const pack = packWith(20, { bidPeriodStart: null, month: "OCT26" });
    expect(byId(runPresendChecks(input(pack, { now: new Date("2026-10-02T00:00:00Z") })), "period-started")).toBeDefined();
    expect(byId(runPresendChecks(input(pack)), "period-started")).toBeUndefined();
  });

  it("stops after the close, says where the close came from, in Central time", () => {
    const check = byId(runPresendChecks(input(packWith(20), { close: { iso: "2026-09-04T17:00:00.000Z", source: "pack" } })), "bid-closed")!;
    expect(check.level).toBe("stop");
    expect(check.message).toContain("Sep 4, 1200 CT");
    expect(check.message).toContain("pack's bid calendar");
  });

  it("warns inside the last day, and stays quiet before that", () => {
    const soon = runPresendChecks(input(packWith(20), { close: { iso: "2026-09-06T02:00:00.000Z", source: "contract" } }));
    expect(byId(soon, "bid-closing")!.message).toContain("in 14 hours");
    expect(byId(soon, "bid-closing")!.message).toContain("25.C.4");
    const later = runPresendChecks(input(packWith(20), { close: { iso: "2026-09-10T02:00:00.000Z", source: "pilot" } }));
    expect(byId(later, "bid-closing")).toBeUndefined();
    expect(byId(later, "no-close")).toBeUndefined();
  });

  it("says so when it doesn't know the close", () => {
    expect(byId(runPresendChecks(input(packWith(20))), "no-close")!.level).toBe("info");
  });

  it("warns when the pilot's number isn't on this pack's list", () => {
    const pack = packWith(20);
    expect(byId(runPresendChecks(input(pack, { seniority: deriveSeniorityInput(pack, { seniorityNumber: 1500 }) })), "not-on-list")!.level).toBe("warn");
    expect(byId(runPresendChecks(input(pack, { seniority: deriveSeniorityInput(pack, { seniorityNumber: 1005 }) })), "not-on-list")).toBeUndefined();
    const between = packWith(20);
    between.seniorityList = between.seniorityList!.map((e) => ({ ...e, seniority: 1000 + e.bidNumber * 2 }));
    expect(byId(runPresendChecks(input(between, { seniority: deriveSeniorityInput(between, { seniorityNumber: 1003 }) })), "not-on-list")!.level).toBe("warn");
  });
});

describe("order sanity", () => {
  const scored = (pack: BidPack, broken: number[]) =>
    pack.lines.map((line, i) => ({ line, violatedDealbreakers: broken.includes(i) ? [{ statement: "x", label: "Needs Oct 17 off", detail: "Works Oct 17" }] : [] })) as unknown as LineScore[];

  it("names a line in the top 10 that breaks a dealbreaker", () => {
    const pack = packWith(20);
    const check = byId(runPresendChecks(input(pack, { lineScores: scored(pack, [1, 3]) })), "dealbreaker-on-top")!;
    expect(check.level).toBe("warn");
    expect(check.message).toContain("2 lines");
    expect(check.message).toContain(`line ${pack.lines[1].lineNumber}, Works Oct 17`);
  });

  it("keeps the warning about lines left out", () => {
    expect(byId(runPresendChecks(input(packWith(20), { leftOut: 3 })), "left-out")!.message).toContain("3 lines");
  });

  it("orders stops before warnings before notes", () => {
    const pack = { ...packWith(20), id: SAMPLE_BID_PACK.id };
    const levels = runPresendChecks(input(pack, { leftOut: 1 })).map((c) => c.level);
    expect(levels).toEqual([...levels].sort((a, b) => ["stop", "warn", "info"].indexOf(a) - ["stop", "warn", "info"].indexOf(b)));
    expect(levels[0]).toBe("stop");
  });
});

describe("VIPS questions explained", () => {
  it("explains all four and quotes the section", () => {
    const notes = vipsQuestionNotes(packWith(20), ["9001"]);
    expect(notes.waiveBufferRecurrent.meaning).toContain("25.E.1.c");
    expect(notes.waiveBufferPhaseIn.meaning).toContain("25.E.1.c");
    expect(notes.waive1in10.meaning).toContain("12.C.1.c");
    expect(notes.protectMinDays.meaning).toContain("25.F.7");
  });
});

// The October packs live outside the repo; these run wherever they're on disk.
const PACKS = ".cache/packs";
const packFiles = existsSync(PACKS) ? readdirSync(PACKS).filter((f) => f.endsWith(".json")) : [];

describe.skipIf(packFiles.length === 0)("on the October packs", () => {
  const load = (f: string) => restoreBidPack(JSON.parse(readFileSync(`${PACKS}/${f}`, "utf8")));

  it("no published line fails the contract's construction limits", () => {
    for (const f of packFiles) expect(byId(runPresendChecks(input(load(f))), "construction"), f).toBeUndefined();
  });

  it("every pack's bands and run-out checks agree with where the pilot stands", () => {
    for (const f of packFiles) {
      const pack = load(f);
      const list = pack.seniorityList ?? [];
      if (!list.length) continue;
      const first = list.find((e) => !e.pay)!;
      const last = list[list.length - 1];
      const run = (e: SeniorityEntry) =>
        runPresendChecks(
          input(pack, {
            seniority: deriveSeniorityInput(pack, { seniorityNumber: e.seniority }),
            forecast: forecastBid({ bidPack: pack, seniorityNumber: e.seniority, myRanking: pack.lines.map((l) => l.id), simulations: 50 }),
          })
        );
      expect(byId(run(first), "run-out")!.level, f).toBe("info");
      expect(byId(run(last), "run-out")!.level, f).toBe("warn");
      expect(byId(run(last), "catch-all")!.level, f).toBe("warn");
    }
  });

  it("flags an October pack as over in November", () => {
    for (const f of packFiles) expect(byId(runPresendChecks(input(load(f), { now: new Date("2026-11-07T12:00:00Z") })), "period-started"), f).toBeDefined();
  });
});
