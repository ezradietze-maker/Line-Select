import { describe, expect, it } from "vitest";
import { CHART, DOCS, NODES, contractNode, findNode, fullText, sectionPath } from "./index";

describe("the contract index", () => {
  it("finds known sections with the right words", () => {
    expect(contractNode("25.F.3.a")?.text).toContain("a trip in the new bid period in excess of 120 hours TAFB");
    expect(contractNode("25.F.3.a")?.page).toBe(159);
    expect(contractNode("7.E.2")?.title).toBe("Vacation Period Slide");
    expect(fullText("7.E.2")).toContain("A pilot may enter a vacation slide submission during the Conflict Input Window");
    expect(contractNode("12.C.6.a")?.text).toContain("scheduled for not less than 9:30 hours");
    expect(contractNode("25.E.6")?.text).toContain("not less than 115 hours beginning at 1700 CT");
    expect(contractNode("25.A.7.b.i.(c)")?.text).toContain("significant operational disruptions");
  });

  it("keeps the 2015 words apart from the 2026 words", () => {
    const rest = contractNode("12.C.6.a")!;
    expect(rest.changed).toBe(true);
    expect(rest.old).toContain("not less than 9 hours");
    expect(rest.text).not.toContain("not less than 9 hours");
    const sww = contractNode("25.E.6")!;
    expect(sww.old).toContain("144 hours");
    expect(sww.text).not.toContain("144");
    expect(contractNode("25.L.4.d")?.text).toContain("by more than 7 CH");
    expect(contractNode("25.L.4.d")?.old).toContain("by more than 6 CH");
  });

  it("has no deleted words run into new ones", () => {
    const all = NODES.map((n) => n.text).join(" ");
    expect(all).not.toContain("DefinitionDefinitions");
    expect(all).not.toContain("by more than 67");
    expect(all).not.toContain("pilots Pilots");
  });

  it("every section of the public agreement is there, and the numbering went all the way through", () => {
    for (const d of ["1", "3", "4", "5", "7", "8", "12", "15", "23", "25", "26", "28", "31"]) expect(DOCS.some((x) => x.id === d)).toBe(true);
    for (const id of ["25.AA", "25.BB", "26.CC", "26.K", "26.Y.7", "7.I.3.f", "25.M.6.c", "8.C.5.c", "12.D.1.f"]) expect(contractNode(id), id).toBeDefined();
  });

  it("reads a section number however it's punctuated, and nothing made up", () => {
    expect(findNode("Section 25.E.6.")?.id).toBe("25.E.6");
    expect(findNode("CBA 2026 25.F.1.b")?.id).toBe("25.F.1.b");
    expect(findNode("25.A.7.b.i(c)")?.id).toBe("25.A.7.b.i.(c)");
    expect(findNode("25.A.7.b.i.c")?.id).toBe("25.A.7.b.i.(c)");
    expect(findNode("25.E.99")).toBeUndefined();
    expect(findNode("13.A.1")).toBeUndefined();
  });

  it("names a section by its headings", () => {
    expect(sectionPath("25.E.6")).toBe("Bid Period Processing › Secondary Working Window (SWW)");
  });

  it("carries the phase chart, tied to real sections", () => {
    expect(CHART.length).toBeGreaterThan(170);
    const missing = CHART.flatMap((r) => r.refs).filter((r) => !contractNode(r));
    // Provisions the deal deleted, so there's no 2026 piece of that number, and a pay table's row.
    expect(missing.sort()).toEqual(["3.C.7", "4.A.2.b", "4.A.2.c", "4.A.6"]);
  });
});
