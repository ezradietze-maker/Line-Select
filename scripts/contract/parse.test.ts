import { describe, expect, it } from "vitest";
import { expandRefs } from "./parse-chart";
import { markerCandidates } from "./parse-sections";

describe("reading section markers", () => {
  it("tells markers apart", () => {
    expect(markerCandidates("A.")).toEqual([{ kind: "cap", ord: 1, label: "A" }]);
    expect(markerCandidates("BB.")).toEqual([{ kind: "cap", ord: 28, label: "BB" }]);
    expect(markerCandidates("7.")).toEqual([{ kind: "num", ord: 7, label: "7" }]);
    expect(markerCandidates("(c)")[0]).toEqual({ kind: "plow", ord: 3, label: "(c)" });
    expect(markerCandidates("word")).toEqual([]);
  });

  it("knows i. can be a letter or a roman numeral", () => {
    expect(markerCandidates("i.").map((c) => c.kind)).toEqual(["low", "rom"]);
    expect(markerCandidates("vii.").map((c) => c.kind)).toEqual(["rom"]);
  });
});

describe("reading the implementation chart's references", () => {
  it("expands shorthand into full section numbers", () => {
    expect(expandRefs("25.E.6.")).toEqual(["25.E.6"]);
    expect(expandRefs("1.E. and F.")).toEqual(["1.E", "1.F"]);
    expect(expandRefs("25.L.4.d. and 5.c.")).toEqual(["25.L.4.d", "25.L.5.c"]);
    expect(expandRefs("4.A.2.b. and c.; A.6.")).toEqual(["4.A.2.b", "4.A.2.c", "4.A.6"]);
    expect(expandRefs("12.C.2.d.i.(c); 12.C.6.b.ii.")).toEqual(["12.C.2.d.i.(c)", "12.C.6.b.ii"]);
  });
});
