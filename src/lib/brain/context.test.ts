import { describe, expect, it } from "vitest";
import { pilotContextFor } from "@/lib/brain/context";

const pack = { aircraft: "MD11", seat: "CAP" as const, base: "MEM", month: "OCT26", lines: [] };

describe("pilotContextFor", () => {
  it("tells the brain how much time at home makes going home worth it for a commuter", () => {
    const text = pilotContextFor(pack, { isCommuter: true, commuteFrom: "SAN", hasCrashPad: false, minHomeHours: 36 });
    expect(text).toContain("Commutes to base from SAN, no crash pad.");
    expect(text).toContain("at least 36 hours at home");
    expect(pilotContextFor(pack, { isCommuter: true, commuteFrom: "SAN", hasCrashPad: false })).not.toContain("hours at home");
  });
});
