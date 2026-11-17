import { describe, expect, it } from "vitest";
import { chainSentence } from "@/components/results/MiniLinePreview";
import { buildDetailedMonth } from "@/lib/month-detail";
import { SAMPLE_BID_PACK, sampleLineOn } from "@/lib/sample-bidpack";

const START = "2026-09-28";
const line = SAMPLE_BID_PACK.lines.find((l) => l.lineNumber === "9006")!;
const placed = (starts: number[]) => sampleLineOn(line, starts);

describe("why two trips are one departure", () => {
  it("says the hours at home the trips were joined by", () => {
    const chainOf = (homeAirports: string[], minHomeHours?: number) =>
      buildDetailedMonth(placed([2, 5]), START, 28, {}, { base: SAMPLE_BID_PACK.base, homeAirports, ...(minHomeHours ? { minHomeHours } : {}) }).days.find((d) => d.chain)?.chain;
    // Two days between the trips: one departure only for a commuter who goes home for two days or more.
    expect(chainOf(["SAN"])).toBeUndefined();
    const chain = chainOf(["SAN"], 48)!;
    expect(chain.homeHours).toBe(48);
    expect(chainSentence(chain)).toContain("have 48 hours there");
  });

  it("doesn't tell a pilot who lives at base he can't get home on a turn there", () => {
    const chain = { fromTripNumber: "101", city: "MEM", turnMinutes: 9 * 60, landed: "06:00", reports: "15:00", homeHours: null };
    expect(chainSentence(chain)).toBe("Follows trip #101 after 9h00 in MEM: lands MEM 06:00, reports again 15:00 (L). Under 12 hours between them, so the two count as one departure.");
    expect(chainSentence({ ...chain, homeHours: undefined })).toContain("have 24 hours there");
  });
});
