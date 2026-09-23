import { describe, expect, it } from "vitest";
import { SENIORITY_BANDS, seniorityFromBand } from "@/lib/seniority-bands";

describe("seniority bands", () => {
  it("maps each band to a valid rank/total, more senior bands having a smaller share", () => {
    const shares = SENIORITY_BANDS.map((b) => b.input.rank / b.input.totalPilots);
    for (const b of SENIORITY_BANDS) {
      expect(b.input.rank).toBeGreaterThanOrEqual(1);
      expect(b.input.totalPilots).toBeGreaterThanOrEqual(b.input.rank);
    }
    expect([...shares].sort((a, b) => a - b)).toEqual(shares);
  });

  it("returns a copy, so a caller can't mutate the shared table", () => {
    const a = seniorityFromBand("middle-third");
    a.rank = 999;
    expect(seniorityFromBand("middle-third").rank).toBe(50);
  });
});
