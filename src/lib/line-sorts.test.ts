import { existsSync, readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreBidPack } from "@/lib/bidpack-storage";
import {
  applySort,
  betterLabel,
  buildSortContext,
  DEFAULT_SORT,
  formatSortValue,
  highFirst,
  LINE_NUMBER_SORT,
  LINE_SORTS,
  LINE_SORTS_BY_ID,
  loadSortChoice,
  MATCH_SORT,
  NOT_A_SORT,
  previewSort,
  resolveSort,
  saveSortChoice,
  searchSorts,
  sortAvailable,
  sortValues,
  type SortContext,
} from "@/lib/line-sorts";
import { METRICS } from "@/lib/metrics/catalog";
import { prepareMetrics } from "@/lib/metrics/compute";
import { monthDepartureOptions } from "@/lib/month-detail";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { LineScore } from "@/lib/scoring";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const scored = (pack: BidPack) => pack.lines.map((line, i) => ({ line, score: 100 - i }) as unknown as LineScore);

const commuter = {
  isCommuter: true,
  commuteFrom: "DEN",
  hasCrashPad: false,
  minHomeHours: 24,
  discoveredFacts: [],
} as unknown as PreferenceProfile;

function contextFor(pack: BidPack, profile: PreferenceProfile = commuter): SortContext {
  return buildSortContext(pack, profile, prepareMetrics(pack), monthDepartureOptions(pack.base, profile));
}

describe("the sort table", () => {
  it("covers every measure the scorer computes", () => {
    const missing = METRICS.filter((m) => !m.retired && !LINE_SORTS_BY_ID.has(m.id) && !NOT_A_SORT[m.id]).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it("names nothing the catalog retired, or that it doesn't have, except the sorts worked out here", () => {
    const own = new Set([MATCH_SORT, LINE_NUMBER_SORT, "carryOverCredit", "totalCredit", "requestedDatesKept"]);
    const known = new Set(METRICS.filter((m) => !m.retired).map((m) => m.id));
    expect(LINE_SORTS.filter((s) => !known.has(s.id) && !own.has(s.id)).map((s) => s.id)).toEqual([]);
  });

  it("gives each sort a one-line definition and a unique name", () => {
    for (const s of LINE_SORTS) {
      expect(s.definition.length, s.id).toBeGreaterThan(10);
      expect(s.definition.length, s.id).toBeLessThanOrEqual(140);
    }
    expect(new Set(LINE_SORTS.map((s) => s.label)).size).toBe(LINE_SORTS.length);
    expect(new Set(LINE_SORTS.map((s) => s.id)).size).toBe(LINE_SORTS.length);
  });

  it("says day flying precisely, and which way is better", () => {
    const day = LINE_SORTS_BY_ID.get("dayFlyingShare")!;
    expect(day.definition).toContain("06:00 and 22:00 local");
    expect(betterLabel(day)).toBe("Higher is better");
    expect(betterLabel(LINE_SORTS_BY_ID.get("landings")!)).toBe("Fewer is better");
    expect(betterLabel(LINE_SORTS_BY_ID.get("earliestBaseReport")!)).toBe("Later is better");
    expect(betterLabel(LINE_SORTS_BY_ID.get("blockHours")!)).toBe("");
  });
});

describe("applySort", () => {
  const list = scored(SAMPLE_BID_PACK);
  const ctx = contextFor(SAMPLE_BID_PACK);

  it("keeps the ranked list as it is for best match", () => {
    expect(applySort(list, DEFAULT_SORT, ctx)).toBe(list);
    expect(applySort(list, DEFAULT_SORT, null)).toBe(list);
  });

  it("sorts line numbers numerically and flips", () => {
    const up = applySort(list, { id: LINE_NUMBER_SORT }, ctx).map((r) => Number(r.line.lineNumber));
    expect(up).toEqual([...up].sort((a, b) => a - b));
    expect(applySort(list, { id: LINE_NUMBER_SORT, reversed: true }, ctx).map((r) => Number(r.line.lineNumber))).toEqual([...up].reverse());
  });

  it("puts the better end first, breaks ties by score, and never mutates the list", () => {
    const before = list.map((r) => r.line.id);
    const out = applySort(list, { id: "daysOff" }, ctx);
    for (let i = 1; i < out.length; i++) {
      const [a, b] = [out[i - 1], out[i]];
      expect(a.line.daysOff).toBeGreaterThanOrEqual(b.line.daysOff);
      if (a.line.daysOff === b.line.daysOff) expect(a.score).toBeGreaterThanOrEqual(b.score);
    }
    expect(list.map((r) => r.line.id)).toEqual(before);
    expect(highFirst(LINE_SORTS_BY_ID.get("landings")!, { id: "landings" })).toBe(false);
    expect(highFirst(LINE_SORTS_BY_ID.get("landings")!, { id: "landings", reversed: true })).toBe(true);
  });

  it("puts lines it can't read last, whichever way it's sorted", () => {
    const pack: BidPack = { ...SAMPLE_BID_PACK, lines: SAMPLE_BID_PACK.lines.map((l, i) => (i === 0 ? { ...l, estimated: true } : l)) };
    const here = contextFor(pack);
    const rows = scored(pack);
    expect(sortValues(LINE_SORTS_BY_ID.get("avgTripDays")!, { id: "avgTripDays" }, here).get(pack.lines[0].id)).toBeNull();
    expect(applySort(rows, { id: "avgTripDays" }, here).at(-1)!.line.id).toBe(pack.lines[0].id);
    expect(applySort(rows, { id: "avgTripDays", reversed: true }, here).at(-1)!.line.id).toBe(pack.lines[0].id);
  });

  it("falls back to the plain ranking for a sort the pilot can't use", () => {
    const here = contextFor(SAMPLE_BID_PACK, { discoveredFacts: [] } as unknown as PreferenceProfile);
    expect(sortAvailable(LINE_SORTS_BY_ID.get("departureCommutes")!, here)).toBe(false);
    expect(resolveSort({ id: "departureCommutes" }, here).id).toBe(MATCH_SORT);
    expect(applySort(list, { id: "departureCommutes", reversed: true }, here)).toBe(list);
  });
});

describe("requested days off kept", () => {
  const start = "2026-10-01";
  // The sample pack has no real dates of its own: a month, with each line off on its first few days plus one apart.
  const pack: BidPack = {
    ...SAMPLE_BID_PACK,
    bidPeriodStart: start,
    bidPeriodDays: 31,
    lines: SAMPLE_BID_PACK.lines.map((l, i) => ({ ...l, gridOffDays: i % 2 ? [2, 9] : [2, 20] })),
  };
  const dateAt = (i: number) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
  const profile = { discoveredFacts: [{ specificDates: [dateAt(2), dateAt(9), "2001-01-01"] }] } as unknown as PreferenceProfile;

  it("counts only dates in the bid month, and reads them from the line's calendar", () => {
    const ctx = contextFor(pack, profile);
    const def = LINE_SORTS_BY_ID.get("requestedDatesKept")!;
    expect(ctx.dates).toEqual([dateAt(2), dateAt(9)]);
    expect(sortAvailable(def, ctx)).toBe(true);
    for (const line of pack.lines) {
      const v = sortValues(def, { id: def.id }, ctx).get(line.id) ?? null;
      if (line.estimated || !line.gridOffDays) {
        expect(v).toBeNull();
        continue;
      }
      const off = new Set(line.gridOffDays);
      expect(v).toBe([2, 9].filter((i) => off.has(i)).length);
    }
    expect(formatSortValue(def, 1, ctx)).toBe("1 of 2 kept");
  });

  it("isn't offered to a pilot with no dates this month", () => {
    expect(sortAvailable(LINE_SORTS_BY_ID.get("requestedDatesKept")!, contextFor(pack))).toBe(false);
  });
});

describe("formatSortValue", () => {
  const ctx = { dates: [] };
  const f = (id: string, v: number | null) => formatSortValue(LINE_SORTS_BY_ID.get(id)!, v, ctx);
  it("says each value in its own unit", () => {
    expect(f("creditHours", 85.25)).toBe("85.3 hrs");
    expect(f("creditPerDayAway", 5.126)).toBe("5.13 hrs per day");
    expect(f("creditPerBlockHour", 1.8)).toBe("1.80 per block hr");
    expect(f("dayFlyingShare", 0.625)).toBe("63%");
    expect(f("earliestBaseReport", 330)).toBe("05:30");
    expect(f("latestBaseRelease", 1590)).toBe("02:30");
    expect(f("dutyPeriods", 1)).toBe("1 duty");
    expect(f("dutyPeriods", 12)).toBe("12 duties");
    expect(f("tripCount", 3.6)).toBe("3.6 trips");
    expect(f("bodyClockScore", 71.6)).toBe("72");
    expect(f("daysOff", null)).toBe("Not known");
  });
});

describe("searchSorts", () => {
  it("finds by name first, then by definition", () => {
    const found = searchSorts(LINE_SORTS, "hub turn").map((s) => s.id);
    expect(found.slice(0, 2)).toEqual(expect.arrayContaining(["hubTurns"]));
    expect(found).toContain("nightHubTurnRuns");
    expect(searchSorts(LINE_SORTS, "tafb").map((s) => s.id)).toEqual(["tafbHours"]);
    expect(searchSorts(LINE_SORTS, "   ")).toBe(LINE_SORTS);
    expect(searchSorts(LINE_SORTS, "zzzz")).toEqual([]);
  });
});

describe("remembering the sort", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    });
  });

  it("keeps one sort per pack and pilot", () => {
    saveSortChoice(null, "pack-a", { id: "landings", reversed: true });
    expect(loadSortChoice(null, "pack-a")).toEqual({ id: "landings", reversed: true });
    expect(loadSortChoice(null, "pack-b")).toEqual(DEFAULT_SORT);
    expect(loadSortChoice("user-1", "pack-a")).toEqual(DEFAULT_SORT);
  });

  it("drops a sort that no longer exists, and anything malformed", () => {
    window.localStorage.setItem("line-select:line-sort:guest:p:v1", JSON.stringify({ id: "gone" }));
    expect(loadSortChoice(null, "p")).toEqual(DEFAULT_SORT);
    window.localStorage.setItem("line-select:line-sort:guest:p:v1", "{nope");
    expect(loadSortChoice(null, "p")).toEqual(DEFAULT_SORT);
    window.localStorage.setItem("line-select:line-sort:guest:p:v1", JSON.stringify({ id: "hubTurns", region: "narnia", city: 4 }));
    expect(loadSortChoice(null, "p")).toEqual({ id: "hubTurns" });
  });
});

// The 14 October seats, where they exist: they aren't in the repository, so this runs on a machine that has them.
const PACKS_DIR = ".cache/packs";
const seats = existsSync(PACKS_DIR) ? readdirSync(PACKS_DIR).filter((f) => f.startsWith("OCT26") && f.endsWith(".json")) : [];

describe.skipIf(seats.length === 0)("every sort on the October seats", () => {
  it.each(seats)("%s", (file) => {
    const pack = restoreBidPack(JSON.parse(readFileSync(`${PACKS_DIR}/${file}`, "utf8")));
    const list = scored(pack);
    const live = { discoveredFacts: [{ specificDates: [pack.bidPeriodStart!] }] } as unknown as PreferenceProfile;
    for (const profile of [{ ...commuter, ...live }, live]) {
      const ctx = contextFor(pack, profile);
      for (const def of LINE_SORTS) {
        if (!sortAvailable(def, ctx)) continue;
        const choices = def.needs === "region" ? [{ id: def.id, region: "asia" as const }] : [{ id: def.id }];
        for (const choice of choices) {
          const out = applySort(list, choice, ctx);
          expect(out.length, def.id).toBe(list.length);
          if (def.group === "order") continue;
          const values = sortValues(def, choice, ctx);
          const nums = out.map((r) => values.get(r.line.id) ?? null);
          // Never NaN; unknown lines last; in order among the known ones.
          expect(nums.some((v) => v !== null && !Number.isFinite(v)), def.id).toBe(false);
          const firstNull = nums.indexOf(null);
          if (firstNull >= 0) expect(nums.slice(firstNull).every((v) => v === null), def.id).toBe(true);
          const known = nums.filter((v): v is number => v !== null);
          const sign = highFirst(def, choice) ? -1 : 1;
          for (let i = 1; i < known.length; i++) expect(sign * (known[i] - known[i - 1]), def.id).toBeGreaterThanOrEqual(0);
          // Offered means it reads something on a real pack.
          if (def.needs !== "flights") expect(known.length, `${def.id} on ${file}`).toBeGreaterThan(0);
          expect(previewSort(list, def, choice, ctx).top.length, def.id).toBe(Math.min(3, list.length));
        }
      }
    }
  }, 120_000);
});
