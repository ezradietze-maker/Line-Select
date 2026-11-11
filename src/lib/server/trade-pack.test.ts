import { describe, expect, it } from "vitest";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { tradePackFingerprint } from "@/lib/server/pack-fingerprint";
import { groupFingerprint } from "@/lib/server/trade-pack";

describe("which copy of a pack trades are matched on", () => {
  it("names the same pack the same way, and a pack with a trip moved or retimed another way", () => {
    const same = structuredClone(SAMPLE_BID_PACK);
    expect(tradePackFingerprint(same)).toBe(tradePackFingerprint(SAMPLE_BID_PACK));
    const moved = structuredClone(SAMPLE_BID_PACK);
    moved.lines[0].trips[0].startDayIndex = (moved.lines[0].trips[0].startDayIndex ?? 0) + 1;
    expect(tradePackFingerprint(moved)).not.toBe(tradePackFingerprint(SAMPLE_BID_PACK));
    const retimed = structuredClone(SAMPLE_BID_PACK);
    retimed.lines[0].trips[0].schedule[0].reportTimeLocal = "0001";
    expect(tradePackFingerprint(retimed)).not.toBe(tradePackFingerprint(SAMPLE_BID_PACK));
  });

  it("ignores what trades don't use, such as the pack's id", () => {
    const noted = { ...structuredClone(SAMPLE_BID_PACK), id: "another-id" };
    expect(tradePackFingerprint(noted)).toBe(tradePackFingerprint(SAMPLE_BID_PACK));
  });

  it("goes with the copy most of the group confirmed on, a tie to the latest", () => {
    expect(groupFingerprint([])).toBeNull();
    expect(groupFingerprint([{ fingerprint: null, confirmedAt: "2026-12-01" }])).toBeNull();
    const at = (d: string, fingerprint: string | null) => ({ fingerprint, confirmedAt: `2026-12-${d}` });
    expect(groupFingerprint([at("01", "a"), at("02", "a"), at("03", "b")])).toBe("a");
    expect(groupFingerprint([at("01", "a"), at("03", "b")])).toBe("b");
    expect(groupFingerprint([at("01", "a"), at("02", null), at("03", null)])).toBe("a");
  });
});
