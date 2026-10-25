import { describe, expect, it } from "vitest";
import { extractBidPeriodDays, extractBidPeriodStart } from "@/lib/pdf-parser/line-grid-days";
import { extractMetaFromLineGridHeader } from "@/lib/pdf-parser/meta";

describe("the bid period, from the line pages' own printed dates", () => {
  it("reads a four-week bid month's first day and length", () => {
    const header = "OCT   (2026-09-28   -   2026-10-25) - MD11 MEM DOMICILE - Captain ONLY";
    expect(extractBidPeriodStart(header)).toBe("2026-09-28");
    expect(extractBidPeriodDays(header)).toBe(28);
    expect(extractMetaFromLineGridHeader(header)).toMatchObject({ aircraft: "MD11", base: "MEM", seat: "CAP", bidPeriodStart: "2026-09-28", bidPeriodDays: 28 });
  });

  it("reads whatever period the header prints, across a month and year end", () => {
    expect(extractBidPeriodDays("JAN (2026-12-28 - 2027-01-31) - B767 OAK DOMICILE - First Officer ONLY")).toBe(35);
  });

  it("gives nothing for a header without a sane printed range", () => {
    expect(extractBidPeriodDays("MD11 MEM DOMICILE - Captain ONLY")).toBeNull();
    expect(extractBidPeriodDays("OCT (2026-10-25 - 2026-09-28) - MD11 MEM DOMICILE - Captain ONLY")).toBeNull();
  });
});
