import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VacationLineControl, vacationHint } from "@/components/results/VacationLineControl";
import type { LineVacationOptions, VacationOption } from "@/lib/vacation-engine";
import type { VacationPlacement } from "@/lib/vacation-lines";

describe("the Vacation drop-down's words, closed", () => {
  it("says where it is on the line, what it takes off, and whether it can slide", () => {
    expect(vacationHint(1, undefined, true)).toBe("where the pack has it · takes off 1 trip · slide it");
    expect(vacationHint(2, { offsets: { v: 4 } }, true)).toBe("slid 4 days later · takes off 2 trips · slide it");
    expect(vacationHint(0, { offsets: { v: -1 } }, false)).toBe("slid 1 day earlier · takes off no trips");
  });

  it("names an expansion (CBA 2026 7.E.3): it isn't where the pack has it", () => {
    expect(vacationHint(1, { offsets: { v: 0 }, expand: { v: { before: 0, after: 8 } } }, true)).toBe("expanded 8 days later · takes off 1 trip · slide it");
    expect(vacationHint(3, { offsets: { v: 2 }, expand: { v: { before: 1, after: 0 } } }, true)).toBe("slid 2 days later and expanded 1 day earlier · takes off 3 trips · slide it");
  });
});

describe("stepping the vacation on an opened line", () => {
  const option = (placement: VacationPlacement, daysOff: number, bankCH: number): VacationOption =>
    ({ placement, key: "", shift: 0, expandBefore: placement.expand?.v.before ?? 0, expandAfter: placement.expand?.v.after ?? 0, daysOff, bankCH, waived: false }) as VacationOption;
  const expanded = { offsets: { v: 0 }, expand: { v: { before: 0, after: 8 } } };
  const line: LineVacationOptions = { lineId: "l", reach: [], options: [option({ offsets: { v: 0 } }, 17, 0), option({ offsets: { v: 1 } }, 18, 10), option(expanded, 23, 49.2)] };
  const html = (placement: VacationPlacement | undefined) =>
    renderToStaticMarkup(createElement(VacationLineControl, { line, placement, overridden: false, onPlace: () => {}, onReset: () => {} }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

  it("shows an expanded placement as it is, not as where the pack has it", () => {
    expect(html(expanded)).toContain("expanded 8 days later");
    expect(html(expanded)).not.toContain("where the pack has it");
    expect(html(expanded)).toContain("23 days off, 49:12 CH from your bank");
    expect(html(undefined)).toContain("where the pack has it");
  });
});
