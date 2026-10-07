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
});
