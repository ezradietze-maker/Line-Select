import { describe, expect, it } from "vitest";
import { bidOrderWords } from "@/components/results/ForecastBanner";
import { forecastBid } from "@/lib/forecast/forecast";
import type { BidPack, Line } from "@/types/bidpack";

const lines: Line[] = Array.from({ length: 4 }, (_, i) => ({ id: `line-${i}`, lineNumber: String(100 + i), trips: [], daysOff: 12 + i, totalCreditHours: 80, totalTafbHours: 200, totalLandings: 8, totalDepartures: 8 }));
const pack: BidPack = {
  id: "p",
  month: "OCT26",
  base: "MEM",
  aircraft: "B777",
  seat: "CAP",
  bidPeriodDays: 28,
  bidPeriodStart: null,
  lines,
  seniorityList: Array.from({ length: 10 }, (_, i) => ({ bidNumber: i + 1, seniority: (i + 1) * 3 })),
};
const at = (seniorityNumber: number) => bidOrderWords(forecastBid({ bidPack: pack, seniorityNumber, myRanking: lines.map((l) => l.id), simulations: 20 })!);

describe("the banner's place in bid order", () => {
  it("says a number junior to the whole list falls after it, not one past its count", () => {
    expect(at(99)).toBe("after all 10 in bid order");
    expect(at(30)).toBe("10 of 10 in bid order");
    expect(at(16)).toBe("about 6 of 10 in bid order");
  });
});
