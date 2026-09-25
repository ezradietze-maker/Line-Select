import { describe, expect, it } from "vitest";
import { extractSeniorityListSeat, parseSeniorityListRows, validateSeniorityList } from "@/lib/pdf-parser/seniority-list-parser";
import type { ParseWarning } from "@/lib/pdf-parser/types";

// Rows below are invented (made-up names and numbers) but follow the column layout of a real Bid Seniority List page: two pilots to a row.
describe("seniority list parsing", () => {
  it("reads the seat from the page's own header", () => {
    expect(extractSeniorityListSeat(["MEM77 Page 1", "Bid Seniority List: CAP", "OCT26"])).toBe("CAP");
    expect(extractSeniorityListSeat(["Bid Seniority List: F/O"])).toBe("FO");
    expect(extractSeniorityListSeat(["Reserve Lines: CAP"])).toBeNull();
  });

  it("takes only the bid position and seniority number from each of the two pilots on a row", () => {
    const rows = [
      "Bid # Senr # Employee # Pilot Name Status QL Cons Bid # Senr # Employee # Pilot Name Status QL Cons",
      "1 3 66911 DOE, JANE 38 107 218662 ROE, RICHARD Q",
      "2 11 96885 SMITH, ALEX 39 113 219507 JONES, PAT",
    ];
    expect(parseSeniorityListRows(rows)).toEqual([
      { bidNumber: 1, seniority: 3 },
      { bidNumber: 38, seniority: 107 },
      { bidNumber: 2, seniority: 11 },
      { bidNumber: 39, seniority: 113 },
    ]);
  });

  it("never carries a name or an employee number through", () => {
    const entries = parseSeniorityListRows(["1 3 66911 DOE, JANE 38 107 218662 ROE, RICHARD"]);
    const serialized = JSON.stringify(entries);
    for (const secret of ["66911", "218662", "DOE", "JANE", "ROE", "RICHARD"]) expect(serialized).not.toContain(secret);
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(["bidNumber", "seniority"]);
  });

  it("ignores page headers, dates and other text that isn't a list row", () => {
    const rows = ["MEM77 Page 1", "Bid Seniority List: CAP", "OCT26", "09/03/26 14:06z", "As of Sep 03, 2026", "Bid # Senr # Employee # Pilot Name"];
    expect(parseSeniorityListRows(rows)).toEqual([]);
  });
});

describe("validateSeniorityList", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => ({ bidNumber: i + 1, seniority: (i + 1) * 7 }));

  it("accepts a complete, ordered list", () => {
    const warnings: ParseWarning[] = [];
    expect(validateSeniorityList(list(120), "CAP", warnings)).toHaveLength(120);
    expect(warnings).toHaveLength(0);
  });

  it("puts the list in bid order however the pages were read", () => {
    const shuffled = [...list(20)].reverse();
    expect(validateSeniorityList(shuffled, "CAP", [])!.map((e) => e.bidNumber)).toEqual(list(20).map((e) => e.bidNumber));
  });

  it("tolerates a couple of unreadable rows in a long list", () => {
    const l = list(300).filter((e) => e.bidNumber !== 40 && e.bidNumber !== 41);
    expect(validateSeniorityList(l, "CAP", [])).toHaveLength(298);
  });

  it("rejects a list with holes, out-of-order seniority, or a missing start — and says so", () => {
    for (const bad of [
      list(100).filter((e) => e.bidNumber % 3 !== 0),
      list(50).map((e, i) => (i === 10 ? { ...e, seniority: 1 } : e)),
      list(50).filter((e) => e.bidNumber !== 1),
    ]) {
      const warnings: ParseWarning[] = [];
      expect(validateSeniorityList(bad, "FO", warnings)).toBeNull();
      expect(warnings).toHaveLength(1);
    }
  });

  it("rejects a bid position that appears twice with different numbers", () => {
    const l = [...list(30), { bidNumber: 5, seniority: 999 }];
    expect(validateSeniorityList(l, "CAP", [])).toBeNull();
  });
});
