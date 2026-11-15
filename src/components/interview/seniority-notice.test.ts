import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeniorityNotice } from "@/components/interview/SeniorityStep";

describe("the seniority notice's count", () => {
  it("counts the seat to its last bid number when the list kept a position it didn't read", () => {
    // Bid #2 didn't read: #3 is 3rd of 3, not "3rd in bid order of 2".
    const list = [
      { seniority: 120, bidNumber: 1 },
      { seniority: 901, bidNumber: 3 },
    ];
    const found = renderToStaticMarkup(createElement(SeniorityNotice, { value: "901", list, seat: "FO" }));
    expect(found).toContain("3rd in bid order of 3 first officers");
    const past = renderToStaticMarkup(createElement(SeniorityNotice, { value: "999", list, seat: "FO" }));
    expect(past).toContain("after all 3 on the list");
  });
});
