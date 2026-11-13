import { describe, expect, it } from "vitest";
import { completenessProblems } from "@/lib/pdf-parser";
import type { BidPack, BidPackInfo } from "@/types/bidpack";

const line = (n: string) => ({ lineNumber: n }) as BidPack["lines"][number];
const pack = (numbers: string[], reserve = 0) => ({ lines: numbers.map(line), reserveLines: Array.from({ length: reserve }, () => ({})) }) as unknown as BidPack;
const info = (regular: number, reserve: number) => ({ totalRegularLines: regular, totalReserveLines: reserve }) as BidPackInfo;

describe("what the pack says it holds and the file doesn't", () => {
  it("says nothing when the file has every line its info page counts", () => {
    expect(completenessProblems({ CAP: pack(["1001", "1002"], 1) }, { CAP: info(2, 1) })).toEqual([]);
  });

  it("says so when pages are missing, a listed seat has no lines, or a line appears twice", () => {
    const problems = completenessProblems({ CAP: pack(["1001", "1001"], 0) }, { CAP: info(3, 1), FO: info(4, 2) }).map((p) => p.message);
    expect(problems.some((m) => m.includes("2 of the 3 Captain lines"))).toBe(true);
    expect(problems.some((m) => m.includes("0 of the 1 Captain reserve lines"))).toBe(true);
    expect(problems.some((m) => m.includes("1001 appears twice"))).toBe(true);
    expect(problems.some((m) => m.includes("4 First Officer lines, but this file has none"))).toBe(true);
  });

  it("can't check without an info page, and doesn't guess", () => {
    expect(completenessProblems({ CAP: pack(["1001"]) }, null)).toEqual([]);
  });
});
