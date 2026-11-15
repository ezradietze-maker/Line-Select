import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SunDial } from "@/components/cities/CitySky";

const sky = (code: string, at: string) => renderToStaticMarkup(createElement(SunDial, { code, now: Date.parse(at) }));

describe("the sky there now", () => {
  it("has the sun up on an Asian morning, before the GMT date turns", () => {
    // 07:30 in Tokyo, an hour after sunrise: still the day before in GMT.
    expect(sky("NRT", "2026-11-15T22:30:00Z")).toContain("The sun is up in NRT");
    expect(sky("HKG", "2026-11-15T23:30:00Z")).toContain("The sun is up in HKG");
  });

  it("has the sun up on a Pacific afternoon, after the GMT date turns", () => {
    // 15:00 in Honolulu and 13:00 in Anchorage: already the next day in GMT.
    expect(sky("HNL", "2026-11-16T01:00:00Z")).toContain("The sun is up in HNL");
    expect(sky("ANC", "2026-11-15T22:00:00Z")).toContain("The sun is up in ANC");
  });

  it("has night at night", () => {
    expect(sky("NRT", "2026-11-15T12:00:00Z")).toContain("night in NRT");
    expect(sky("HNL", "2026-11-16T08:00:00Z")).toContain("night in HNL");
    expect(sky("MEM", "2026-11-16T08:00:00Z")).toContain("night in MEM");
  });
});
