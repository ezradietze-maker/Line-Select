import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import type { LineScore } from "@/lib/scoring";
import { DEFAULT_WEIGHTS, type PreferenceProfile } from "@/types/preferences";

vi.mock("@/components/results/CalendarSubscribe", () => ({ CalendarSubscribe: () => null }));
const { BidOrderExport, copiedSaying } = await import("@/components/results/BidOrderExport");

describe("what Copy shortlist says it copied", () => {
  it("names the starred lines it left out for being in Not bid", () => {
    expect(copiedSaying("shortlist", 280, 2, 3, 1)).toBe("Shortlist copied: 2 lines, 1 in Not bid left out");
    expect(copiedSaying("shortlist", 280, 3, 3, 0)).toBe("Shortlist copied: 3 lines");
  });
});

describe("Ready to bid? on a pack whose bid period has begun", () => {
  afterEach(() => vi.useRealTimers());

  const pack = { ...SAMPLE_BID_PACK, id: "real-pack", month: "OCT26", bidPeriodStart: "2026-09-28" };
  const entries = pack.lines.map((line, i) => ({ lineScore: { line, score: 90 - i, explanation: "" } as unknown as LineScore, rank: i + 1 }));
  const view = () =>
    renderToStaticMarkup(
      createElement(BidOrderExport, {
        entries,
        bidPeriodStart: pack.bidPeriodStart,
        bidMonth: pack.month,
        packLabel: "OCT26 · MEM · MD11 · FO",
        leftOut: 0,
        presend: { bidPack: pack, profile: { weights: DEFAULT_WEIGHTS } as unknown as PreferenceProfile, rankedForecast: null, rankedIds: [] },
        topLineNumber: entries[0].lineScore.line.lineNumber,
      })
    );

  it("says the bid is over, where Copy is: a pilot entering the order by hand never opens Send to VIPS's checks", () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T12:00:00Z"), toFake: ["Date"] });
    expect(view()).toContain("The OCT26 bid period has already started");
  });

  it("says nothing of the kind before the period starts", () => {
    vi.useFakeTimers({ now: new Date("2026-09-05T12:00:00Z"), toFake: ["Date"] });
    expect(view()).not.toContain("already started");
  });
});
