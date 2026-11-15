import { existsSync, readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { addDragChoices, withoutDrag } from "@/lib/brain/profile-model";
import { learnFromChoices, swapPairWeights } from "@/lib/brain/reorder-learner";
import {
  addTier,
  applyTiers,
  bringBack,
  canAddTier,
  clearTiers,
  DEFAULT_TIERS,
  EMPTY_HISTORY,
  EMPTY_TIERS,
  hasTiers,
  lessonChanges,
  lessonsFromMove,
  linesThatWouldMove,
  loadTiers,
  MAX_ADDED_TIERS,
  MAX_LINES_TAUGHT,
  MAX_PAIRS_PER_LINE,
  moveToTier,
  NO_TIER_HEADING,
  NOT_BID_ID,
  notBidIds,
  pruneTiers,
  pushHistory,
  redoTiers,
  removeTier,
  renameTier,
  saveTiers,
  setAsideLines,
  swapTiers,
  tierHeadings,
  undoTiers,
  type TierHistory,
  type TierState,
} from "@/lib/line-tiers";
import { applyPlacements } from "@/lib/line-placements";
import type { BidPack, Line } from "@/types/bidpack";
import type { Criterion, PilotModel } from "@/types/pilot-model";

const same = (id: string) => id;
const LIST = ["a", "b", "c", "d", "e", "f", "g"];

describe("the bid order", () => {
  it("is the same list, untouched, until the pilot uses a tier", () => {
    expect(applyTiers(LIST, EMPTY_TIERS, same)).toBe(LIST);
    expect(hasTiers(EMPTY_TIERS)).toBe(false);
  });

  it("puts lines with no tier after the tiers above and before Backup and Not bid, in their own order", () => {
    let s = moveToTier(EMPTY_TIERS, ["e"], "best");
    s = moveToTier(s, ["f"], "good");
    s = moveToTier(s, ["a"], "backup");
    s = moveToTier(s, ["b"], NOT_BID_ID);
    expect(applyTiers(LIST, s, same)).toEqual(["e", "f", "c", "d", "g", "a", "b"]);
  });

  it("keeps score order inside a tier, and a pilot's swap inside it", () => {
    const s = moveToTier(EMPTY_TIERS, ["f", "b", "d"], "best");
    expect(applyTiers(LIST, s, same).slice(0, 3)).toEqual(["b", "d", "f"]);
    const swapped = applyPlacements(LIST, [{ id: "p", order: ["f", "c", "d", "e", "b"] }], same);
    expect(applyTiers(swapped, s, same).slice(0, 3)).toEqual(["f", "d", "b"]);
  });

  it("leaves Not bid out of what gets sent, and a set-aside line in, where it would rank", () => {
    let s = moveToTier(EMPTY_TIERS, ["a"], NOT_BID_ID);
    s = moveToTier(s, ["g"], "best");
    s = setAsideLines(s, ["c"]);
    const out = notBidIds(s);
    expect(applyTiers(LIST, s, same).filter((id) => !out.has(id))).toEqual(["g", "b", "c", "d", "e", "f"]);
  });

  it("treats lines with a tier that's gone as having none", () => {
    const s = { ...EMPTY_TIERS, assigned: { c: "gone", a: "good" } };
    expect(applyTiers(LIST, s, same)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
});

describe("headings", () => {
  it("names each group once with its size, and none until tiers are in use", () => {
    expect(tierHeadings(LIST, EMPTY_TIERS).size).toBe(0);
    let s = moveToTier(EMPTY_TIERS, ["e", "f"], "best");
    s = moveToTier(s, ["a"], "backup");
    const ids = applyTiers(LIST, s, same);
    const h = tierHeadings(ids, s);
    expect([...h.entries()]).toEqual([
      ["e", { name: "Best", count: 2 }],
      ["b", { name: NO_TIER_HEADING, count: 4 }],
      ["a", { name: "Backup", count: 1 }],
    ]);
  });
});

describe("moving lines", () => {
  it("moves several at once, takes a line out of its tier, and brings a set-aside line back", () => {
    let s = moveToTier(EMPTY_TIERS, ["a", "b"], "best");
    expect(s.assigned).toEqual({ a: "best", b: "best" });
    s = moveToTier(s, ["a"], null);
    expect(s.assigned).toEqual({ b: "best" });
    s = setAsideLines(s, ["b", "c"]);
    expect(s.assigned).toEqual({});
    expect(s.setAside).toEqual(["b", "c"]);
    s = moveToTier(s, ["b"], "good");
    expect(s.setAside).toEqual(["c"]);
    expect(bringBack(s, ["c"]).setAside).toEqual([]);
  });

  it("treats a line already there as not moving, so it keeps what it taught", () => {
    let s = moveToTier(EMPTY_TIERS, ["a"], "best");
    s = setAsideLines(s, ["c"]);
    expect(linesThatWouldMove(s, ["a", "b"], "best")).toEqual(["b"]);
    expect(linesThatWouldMove(s, ["b"], null)).toEqual([]);
    expect(linesThatWouldMove(s, ["c"], null)).toEqual(["c"]);
  });

  it("trades tiers on a drag between them, a line with none included", () => {
    const s = moveToTier(EMPTY_TIERS, ["a"], "best");
    expect(swapTiers(s, "a", "b").assigned).toEqual({ b: "best" });
  });

  it("drops what's no longer in the pack", () => {
    let s = moveToTier(EMPTY_TIERS, ["a", "z"], "best");
    s = setAsideLines(s, ["y", "b"]);
    const p = pruneTiers({ ...s, taught: { a: "m1", z: "m2" } }, new Set(["a", "b"]));
    expect(p.assigned).toEqual({ a: "best" });
    expect(p.setAside).toEqual(["b"]);
    expect(p.taught).toEqual({ a: "m1" });
  });
});

describe("the tiers themselves", () => {
  it("renames, ignoring a blank", () => {
    expect(renameTier(EMPTY_TIERS, "best", "  Dream  ").tiers[0].name).toBe("Dream");
    expect(renameTier(EMPTY_TIERS, "best", "   ")).toBe(EMPTY_TIERS);
  });

  it("adds up to 10 above the lines with no tier, and no more", () => {
    let s: TierState = EMPTY_TIERS;
    for (let i = 0; i < MAX_ADDED_TIERS; i++) s = addTier(s, `T${i}`, `t${i}`);
    expect(s.tiers.length).toBe(DEFAULT_TIERS.length + MAX_ADDED_TIERS);
    expect(s.tiers.map((t) => t.id).slice(0, 4)).toEqual(["best", "better", "good", "t0"]);
    expect(s.tiers.at(-1)!.id).toBe(NOT_BID_ID);
    expect(canAddTier(s)).toBe(false);
    expect(addTier(s, "One more", "x")).toBe(s);
  });

  it("removes only tiers the pilot added, and their lines then have none", () => {
    expect(removeTier(EMPTY_TIERS, "best")).toBe(EMPTY_TIERS);
    let s = addTier(EMPTY_TIERS, "Mine", "m");
    s = moveToTier(s, ["a"], "m");
    s = moveToTier(s, ["b"], "best");
    const r = removeTier(s, "m");
    expect(r.tiers.some((t) => t.id === "m")).toBe(false);
    expect(r.assigned).toEqual({ b: "best" });
  });

  it("takes back what a removed tier's lines taught, as taking them out one at a time does", () => {
    let s = addTier(EMPTY_TIERS, "Mine", "m");
    s = { ...moveToTier(moveToTier(s, ["a"], "m"), ["b"], "best"), taught: { a: "move-a", b: "move-b" } };
    const r = removeTier(s, "m");
    expect(r.taught).toEqual({ b: "move-b" });
    expect(lessonChanges(s, r)).toEqual({ retract: ["move-a"], add: [] });
    // Undone, the lesson comes back.
    expect(lessonChanges(r, s)).toEqual({ retract: [], add: ["move-a"] });
  });
});

describe("undo and redo", () => {
  it("round-trips many steps, and a new move drops what could be redone", () => {
    const states: TierState[] = [EMPTY_TIERS];
    let h: TierHistory = EMPTY_HISTORY;
    let s: TierState = EMPTY_TIERS;
    for (const [id, tier] of [["a", "best"], ["b", "good"], ["c", NOT_BID_ID]] as const) {
      h = pushHistory(h, s);
      s = moveToTier(s, [id], tier);
      states.push(s);
    }
    for (let i = 2; i >= 0; i--) {
      const u = undoTiers(h, s)!;
      s = u.state;
      h = u.history;
      expect(s).toEqual(states[i]);
    }
    expect(undoTiers(h, s)).toBeNull();
    for (let i = 1; i <= 3; i++) {
      const r = redoTiers(h, s)!;
      s = r.state;
      h = r.history;
      expect(s).toEqual(states[i]);
    }
    expect(redoTiers(h, s)).toBeNull();
    const back = undoTiers(h, s)!;
    h = pushHistory(back.history, back.state);
    expect(h.future).toEqual([]);
  });

  it("says which lessons a step takes back or gives back", () => {
    const a = { ...EMPTY_TIERS, taught: { x: "m1" } };
    const b = { ...EMPTY_TIERS, taught: { x: "m2", y: "m3" } };
    expect(lessonChanges(a, b)).toEqual({ retract: ["m1"], add: ["m2", "m3"] });
    expect(lessonChanges(b, a)).toEqual({ retract: ["m2", "m3"], add: ["m1"] });
    expect(lessonChanges(clearTiers(a), clearTiers(a))).toEqual({ retract: [], add: [] });
  });
});

describe("storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
  });

  it("round-trips per pack and pilot", () => {
    let s = addTier(EMPTY_TIERS, "Mine", "m");
    s = moveToTier(s, ["a"], "m");
    s = setAsideLines(s, ["b"]);
    s = { ...s, taught: { a: "m1" } };
    saveTiers(null, "p", s);
    expect(loadTiers(null, "p")).toEqual(s);
    expect(loadTiers(null, "q")).toEqual(EMPTY_TIERS);
    expect(loadTiers("u", "p")).toEqual(EMPTY_TIERS);
  });

  it("reads anything broken as no tiers, and a tier that's gone as none", () => {
    window.localStorage.setItem("line-select:line-tiers:guest:p:v1", "{nope");
    expect(loadTiers(null, "p")).toEqual(EMPTY_TIERS);
    window.localStorage.setItem("line-select:line-tiers:guest:p:v1", JSON.stringify({ tiers: "x", assigned: { a: "nowhere", b: "best" }, setAside: [1, "c"] }));
    expect(loadTiers(null, "p")).toEqual({ tiers: DEFAULT_TIERS, assigned: { b: "best" }, setAside: ["c"], taught: {} });
  });
});

describe("what a move teaches", () => {
  const num = (id: string) => id.toUpperCase();

  it("says a line moved up beats what it passed, nearest its new place first", () => {
    const after = applyTiers(LIST, moveToTier(EMPTY_TIERS, ["e"], "best"), same);
    const [lesson] = lessonsFromMove(LIST, after, ["e"], num, "m", "pack");
    expect(lesson.lineId).toBe("e");
    expect(lesson.moveId).toBe("m.0");
    expect(lesson.choices.map((c) => `${c.preferred}>${c.other}`)).toEqual(["E>A", "E>B", "E>C", "E>D"]);
    expect(lesson.choices.every((c) => c.direct && c.dragId === "m.0" && c.packId === "pack" && c.strength === "slightly")).toBe(true);
  });

  it("says a line moved down loses to what it passed, and lines it didn't pass say nothing", () => {
    const after = applyTiers(LIST, moveToTier(EMPTY_TIERS, ["b"], "backup"), same);
    const [lesson] = lessonsFromMove(LIST, after, ["b"], num, "m");
    expect(lesson.choices.map((c) => `${c.preferred}>${c.other}`)).toEqual(["G>B", "F>B", "E>B", "D>B", "C>B"]);
    expect(lesson.choices.some((c) => c.preferred === "A" || c.other === "A")).toBe(false);
  });

  it("counts each line of a bulk move on its own, and none about each other", () => {
    const after = applyTiers(LIST, moveToTier(EMPTY_TIERS, ["e", "f"], "best"), same);
    const lessons = lessonsFromMove(LIST, after, ["e", "f"], num, "m");
    expect(lessons.map((l) => l.moveId)).toEqual(["m.0", "m.1"]);
    for (const l of lessons) expect(l.choices.some((c) => (c.preferred === "E" && c.other === "F") || (c.preferred === "F" && c.other === "E"))).toBe(false);
  });

  it("teaches the pair in a swap of tiers: the line going up over the one coming down, once", () => {
    const tiered = moveToTier(EMPTY_TIERS, ["b"], "best");
    const before = applyTiers(LIST, moveToTier(tiered, ["f"], "good"), same);
    const after = applyTiers(LIST, swapTiers(moveToTier(tiered, ["f"], "good"), "f", "b"), same);
    const lessons = lessonsFromMove(before, after, ["f", "b"], num, "m", undefined, true);
    const all = lessons.flatMap((l) => l.choices.map((c) => `${c.preferred}>${c.other}`));
    expect(all.filter((c) => c === "F>B")).toHaveLength(1);
    expect(all).not.toContain("B>F");
  });

  it("gives one swap's evidence, half on the line it came to rest above", () => {
    const after = applyTiers(LIST, moveToTier(EMPTY_TIERS, ["e"], "best"), same);
    const [lesson] = lessonsFromMove(LIST, after, ["e"], num, "m");
    const w = swapPairWeights(lesson.choices, 2, 0.5);
    expect(w[0]).toBeCloseTo(1);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(2);
  });

  it("teaches nothing when a line stays put, and stays small on a big move", () => {
    const ids = Array.from({ length: 500 }, (_, i) => `l${i}`);
    expect(lessonsFromMove(LIST, LIST, ["a"], num, "m")).toEqual([]);
    const after = applyTiers(ids, moveToTier(EMPTY_TIERS, ["l499"], "best"), same);
    expect(lessonsFromMove(ids, after, ["l499"], num, "m")[0].choices.length).toBe(MAX_PAIRS_PER_LINE);
    const many = ids.slice(100);
    const bulk = applyTiers(ids, moveToTier(EMPTY_TIERS, many, "best"), same);
    expect(lessonsFromMove(ids, bulk, many, num, "m").length).toBeLessThanOrEqual(MAX_LINES_TAUGHT);
  });
});

describe("the learner receives tier moves", () => {
  const line = (id: string, daysOff: number, credit: number): Line =>
    ({ id, lineNumber: id, trips: [], daysOff, totalCreditHours: credit, totalTafbHours: 0, totalLandings: 0, totalDepartures: 0 }) as unknown as Line;
  const pack = {
    id: "p",
    month: "OCT26",
    base: "MEM",
    aircraft: "B767",
    seat: "FO",
    bidPeriodDays: 28,
    bidPeriodStart: "2026-09-28",
    lines: [line("B", 12, 85), line("E", 13, 83), line("C", 15, 78), line("D", 17, 72), line("A", 18, 70)],
  } as unknown as BidPack;
  const crit = (id: string, metric: string, weight: number): Criterion => ({ id, metric, shape: { kind: "more" }, tier: "medium", weight, confidence: 1, label: id, evidence: [], status: "settled" });
  const model = { version: 2, home: null, threads: [], notMeasurable: [], synopsis: "", criteria: [crit("credit", "creditHours", 1), crit("off", "daysOff", 1)] } as unknown as PilotModel;
  const ratio = (m: PilotModel) => m.criteria.find((c) => c.id === "off")!.weight / m.criteria.find((c) => c.id === "credit")!.weight;
  const order = pack.lines.map((l) => l.id);
  const num = (id: string) => id;

  const lessonsFor = (moved: string[], tier: string, moveId: string, from: string[] = order) => {
    const after = applyTiers(from, moveToTier(EMPTY_TIERS, moved, tier), same);
    return lessonsFromMove(from, after, moved, num, moveId, pack.id).flatMap((l) => l.choices);
  };

  it("moves the weights the way the moves point", () => {
    const choices = [...lessonsFor(["A"], "best", "m1"), ...lessonsFor(["D"], "best", "m2"), ...lessonsFor(["B"], "backup", "m3")];
    const r = learnFromChoices(pack, model, choices);
    expect(ratio(r.model)).toBeGreaterThan(ratio(model) * 1.1);
  });

  it("takes back what was learned when the move is undone", () => {
    const one = lessonsFor(["A"], "best", "m1");
    const two = lessonsFor(["D"], "best", "m2");
    const all = addDragChoices(one, two);
    const after = withoutDrag(withoutDrag(all, "m2.0"), "m1.0");
    expect(after).toEqual([]);
    expect(learnFromChoices(pack, model, after).model.criteria.map((c) => c.weight)).toEqual(learnFromChoices(pack, model, []).model.criteria.map((c) => c.weight));
  });

  it("does no harm when the moves contradict each other", () => {
    const steady = [...lessonsFor(["A"], "best", "m1"), ...lessonsFor(["D"], "best", "m2"), ...lessonsFor(["B"], "backup", "m3"), ...lessonsFor(["E"], "backup", "m4")];
    const mixed = [...lessonsFor(["A"], "best", "m1"), ...lessonsFor(["B"], "best", "m2"), ...lessonsFor(["D"], "backup", "m3"), ...lessonsFor(["E"], "best", "m4")];
    const moved = (c: typeof steady) => Math.abs(Math.log(ratio(learnFromChoices(pack, model, c).model) / ratio(model)));
    expect(moved(mixed)).toBeLessThan(moved(steady));
    expect(learnFromChoices(pack, model, mixed).swapNoise!).toBeGreaterThanOrEqual(learnFromChoices(pack, model, steady).swapNoise!);
  });
});

// The 14 October seats, where they exist: they aren't in the repository, so this runs on a machine that has them.
const PACKS_DIR = ".cache/packs";
const seats = existsSync(PACKS_DIR) ? readdirSync(PACKS_DIR).filter((f) => f.startsWith("OCT26") && f.endsWith(".json")) : [];

describe.skipIf(seats.length === 0)("tiers on the October seats", () => {
  it.each(seats)("%s", (file) => {
    const pack = restoreBidPack(JSON.parse(readFileSync(`${PACKS_DIR}/${file}`, "utf8")));
    const ids = pack.lines.map((l) => l.id);
    const third = Math.floor(ids.length / 3);
    let s = moveToTier(EMPTY_TIERS, ids.slice(-3), "best");
    s = moveToTier(s, ids.slice(third, third + 2), "backup");
    s = moveToTier(s, ids.slice(0, 2), NOT_BID_ID);
    s = setAsideLines(s, [ids[third + 3]]);
    const out = applyTiers(ids, s, same);
    expect(new Set(out).size).toBe(ids.length);
    expect(out.slice(0, 3)).toEqual(ids.slice(-3));
    expect(out.slice(-2)).toEqual(ids.slice(0, 2));
    expect(out.filter((id) => !notBidIds(s).has(id)).length).toBe(ids.length - 2);
    expect(out).toContain(ids[third + 3]);
    const lessons = lessonsFromMove(ids, out, ids.slice(-3), (id) => pack.lines.find((l) => l.id === id)?.lineNumber, "m", pack.id);
    expect(lessons.length).toBe(3);
    for (const l of lessons) {
      expect(l.choices.length).toBeGreaterThan(0);
      expect(l.choices.length).toBeLessThanOrEqual(MAX_PAIRS_PER_LINE);
    }
  });
});
