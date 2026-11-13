import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SAVE_FAILED_EVENT } from "@/lib/local-save-failed";
import { loadLineMarks, saveLineMarks } from "@/lib/line-marks-storage";
import { loadPlacements, savePlacements } from "@/lib/line-placements";
import { DEFAULT_SORT, loadSortChoice, saveSortChoice } from "@/lib/line-sorts";
import { EMPTY_TIERS, loadTiers, saveTiers } from "@/lib/line-tiers";

/** A browser's storage that keeps everything, or (`full`) refuses every write, and the events the app would hear. */
function browser(full: boolean) {
  const map = new Map<string, string>();
  const heard: string[] = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException("quota", "QuotaExceededError");
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    },
    dispatchEvent: (e: Event) => (heard.push(e.type), true),
  });
  return { map, heard };
}

const tiers = { ...EMPTY_TIERS, assigned: { "line-1": EMPTY_TIERS.tiers[0].id } };
const marks = { starred: ["line-1"], hidden: [] };
const sort = { id: "creditHours" };
const placements = [{ id: "p1", order: ["line-2", "line-1"] }];

describe("the saves behind a pilot's list", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("are kept, and say so, when the browser has room", () => {
    const { heard } = browser(false);
    expect(saveTiers("u1", "pack", tiers)).toBe(true);
    expect(saveLineMarks("u1", "pack", marks)).toBe(true);
    expect(saveSortChoice("u1", "pack", sort)).toBe(true);
    expect(savePlacements("u1", "pack", placements)).toBe(true);
    expect(loadTiers("u1", "pack").assigned).toEqual(tiers.assigned);
    expect(loadLineMarks("u1", "pack").starred).toEqual(["line-1"]);
    expect(loadSortChoice("u1", "pack").id).toBe("creditHours");
    expect(loadPlacements("u1", "pack")).toEqual(placements);
    expect(heard).toEqual([]);
  });

  it("each tell the app when the browser refuses them, so the pilot hears it won't survive a refresh", () => {
    const { heard } = browser(true);
    expect(saveTiers("u1", "pack", tiers)).toBe(false);
    expect(saveLineMarks("u1", "pack", marks)).toBe(false);
    expect(saveSortChoice("u1", "pack", sort)).toBe(false);
    expect(savePlacements("u1", "pack", placements)).toBe(false);
    expect(heard).toEqual(Array(4).fill(LOCAL_SAVE_FAILED_EVENT));
    expect(loadSortChoice("u1", "pack")).toEqual(DEFAULT_SORT);
  });
});
