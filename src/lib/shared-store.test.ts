import { describe, expect, it } from "vitest";
import { mergeLineMarks } from "@/lib/line-marks-storage";
import { mergePlacements, type Placement } from "@/lib/line-placements";
import { EMPTY_TIERS, mergeTiers, type TierState } from "@/lib/line-tiers";
import { writeMerged, type StoredList } from "@/lib/shared-store";

describe("two tabs on one pack", () => {
  it("keeps the other tab's stars and this tab's, and this tab's say on a line both touched", () => {
    const base = { starred: ["a"], hidden: [] };
    // This tab starred b; the other starred c and hid a.
    const mine = { starred: ["a", "b"], hidden: [] };
    const theirs = { starred: ["c"], hidden: ["a"] };
    expect(mergeLineMarks(base, mine, theirs)).toEqual({ starred: ["c", "b"], hidden: ["a"] });
    // This tab then stars d, which the other tab had hidden since: starring a line un-hides it.
    expect(mergeLineMarks({ starred: [], hidden: [] }, { starred: ["d"], hidden: [] }, { starred: [], hidden: ["d"] })).toEqual({ starred: ["d"], hidden: [] });
    // Nothing changed here: what's stored stands.
    expect(mergeLineMarks(mine, mine, theirs)).toBe(theirs);
  });

  it("keeps both tabs' swaps, this tab's newest last, and drops the ones it took back", () => {
    const p = (id: string, ...order: string[]): Placement => ({ id, order });
    const base = [p("s1", "b", "a")];
    const theirs = [p("s1", "b", "a"), p("s2", "d", "c")];
    expect(mergePlacements(base, [...base, p("s3", "f", "e")], theirs).map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
    expect(mergePlacements(base, [], theirs).map((x) => x.id)).toEqual(["s2"]);
    expect(mergePlacements(base, base, theirs)).toBe(theirs);
  });

  it("keeps the other tab's tier moves, and this tab's on the lines it moved", () => {
    const base: TierState = { ...EMPTY_TIERS, assigned: { a: "best" }, taught: { a: "m1" } };
    const mine: TierState = { ...base, assigned: { a: "best", b: "backup" }, taught: { a: "m1", b: "m2" } };
    const theirs: TierState = { ...base, assigned: { a: "good", c: "best" }, setAside: ["d"], taught: { a: "m3", c: "m4" } };
    expect(mergeTiers(base, mine, theirs)).toEqual({ tiers: EMPTY_TIERS.tiers, assigned: { a: "good", c: "best", b: "backup" }, setAside: ["d"], taught: { a: "m3", c: "m4", b: "m2" } });
    // This tab moved a back out of any tier; the other's move of a to Good is the older word on it.
    const out: TierState = { ...base, assigned: {}, taught: {} };
    expect(mergeTiers(base, out, theirs).assigned).toEqual({ c: "best" });
    // A tier this tab removed takes its lines out of it, the other tab's included.
    const fewer: TierState = { ...base, tiers: EMPTY_TIERS.tiers.filter((t) => t.id !== "good") };
    expect(mergeTiers(base, fewer, theirs).assigned).toEqual({ c: "best" });
  });

  it("merges into what's stored when it writes, and stays in step only with what the browser kept", () => {
    let stored: string[] | null = ["x"];
    let refuse = false;
    const store: StoredList<string[]> = {
      read: () => stored,
      write: (v) => (refuse ? false : ((stored = v), true)),
      merge: (base, mine, theirs) => [...theirs.filter((id) => !base.includes(id) || mine.includes(id)), ...mine.filter((id) => !base.includes(id) && !theirs.includes(id))],
    };
    const synced = { current: [] as string[] };
    expect(writeMerged(store, synced, ["a"])).toEqual(["x", "a"]);
    expect(stored).toEqual(["x", "a"]);
    expect(synced.current).toEqual(["x", "a"]);
    refuse = true;
    expect(writeMerged(store, synced, ["x", "a", "b"])).toEqual(["x", "a", "b"]);
    expect(synced.current).toEqual(["x", "a"]);
  });
});
