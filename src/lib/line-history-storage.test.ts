import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTopLinesSnapshot, saveTopLinesSnapshot } from "@/lib/line-history-storage";
import type { LineScore } from "@/lib/scoring";

const score = (lineNumber: string, value: number) =>
  ({ line: { lineNumber }, score: value, dimensions: [{ key: "daysOff", value: value / 100 }] }) as unknown as LineScore;

// A plain in-memory localStorage — all this module needs from the browser.
const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

describe("top-line history", () => {
  beforeEach(() => store.clear());

  it("never compares a month against its own top lines", () => {
    saveTopLinesSnapshot(null, "OCT26", [score("2283", 69)]);
    expect(loadTopLinesSnapshot(null, "OCT26")).toBeNull();
  });

  it("reads last month's top lines in a new month, and keeps them while this month refreshes", () => {
    saveTopLinesSnapshot(null, "SEP26", [score("1100", 70)]);
    expect(loadTopLinesSnapshot(null, "OCT26")?.map((l) => l.lineNumber)).toEqual(["1100"]);
    saveTopLinesSnapshot(null, "OCT26", [score("2283", 69)]);
    saveTopLinesSnapshot(null, "OCT26", [score("2285", 68)]);
    expect(loadTopLinesSnapshot(null, "OCT26")?.map((l) => l.lineNumber)).toEqual(["1100"]);
    // And next month compares against October's latest.
    expect(loadTopLinesSnapshot(null, "NOV26")?.map((l) => l.lineNumber)).toEqual(["2285"]);
  });

  it("keeps nothing of the sample pack: a pilot's own first pack isn't compared with it, nor the sample with their months", () => {
    saveTopLinesSnapshot(null, "SEP26", [score("1100", 70)]);
    saveTopLinesSnapshot(null, "SAMPLE", [score("9001", 80)]);
    expect(loadTopLinesSnapshot(null, "OCT26")?.map((l) => l.lineNumber)).toEqual(["1100"]);
    expect(loadTopLinesSnapshot(null, "SAMPLE")).toBeNull();
    // One a device kept before: still not read as the month before.
    store.set("line-select:top-lines:guest:v2", JSON.stringify({ current: { month: "SAMPLE", lines: [{ lineNumber: "9001", score: 80, dimensionValues: {} }] }, previous: null }));
    expect(loadTopLinesSnapshot(null, "OCT26")).toBeNull();
  });

  it("doesn't let a sample month a device kept before push the pilot's own last month out", () => {
    // September, then the sample tried (kept as a month before it stopped being), then October's own pack.
    store.set(
      "line-select:top-lines:guest:v2",
      JSON.stringify({ current: { month: "SAMPLE", lines: [{ lineNumber: "9001", score: 80, dimensionValues: {} }] }, previous: { month: "SEP26", lines: [{ lineNumber: "1100", score: 70, dimensionValues: {} }] } })
    );
    saveTopLinesSnapshot(null, "OCT26", [score("2283", 69)]);
    expect(loadTopLinesSnapshot(null, "OCT26")?.map((l) => l.lineNumber)).toEqual(["1100"]);
  });
});
