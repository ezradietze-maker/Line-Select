import { describe, expect, it } from "vitest";
import { crewWords, effectiveWords, legColumns, pairingHeaderFacts, weekdayWords } from "./pairing-header";

describe("pairing header words", () => {
  it("shortens the effective dates the way they're printed", () => {
    expect(effectiveWords("SEPTEMBER 28 - OCTOBER 4")).toBe("Sep 28 – Oct 4");
    expect(effectiveWords("OCTOBER 23 ONLY")).toBe("Oct 23 only");
    expect(effectiveWords("EFFECTIVE SEPTEMBER 29 ONLY")).toBe("Sep 29 only");
    expect(effectiveWords(undefined)).toBeNull();
  });

  it("names the weekdays", () => {
    expect(weekdayWords(["MO", "TU", "SU"])).toBe("Mon Tue Sun");
    expect(weekdayWords([])).toBeNull();
  });

  it("says nothing for a standard crew, and names an augmented one", () => {
    expect(crewWords("STANDARD CREW")).toBeNull();
    expect(crewWords("1 RFO")?.short).toBe("+1 RFO");
    expect(crewWords("1 RF2")?.title).toContain("second relief first officer");
    expect(crewWords("1 CAP")?.title).toContain("extra captain");
  });

  it("puts weekdays and dates together", () => {
    expect(pairingHeaderFacts({ crew: "1 RFO", effectiveText: "OCTOBER 2 - OCTOBER 23", operatesOn: ["FR"] })).toEqual({
      crew: expect.objectContaining({ short: "+1 RFO" }),
      operates: "Fri · Oct 2 – Oct 23",
    });
    expect(pairingHeaderFacts({})).toEqual({ crew: null, operates: null });
  });
});

describe("legColumns", () => {
  it("reads an older pack's lone S meal as the Supplemental flag", () => {
    expect(legColumns({ meal: "S" })).toEqual({ meal: null, supplemental: true });
    expect(legColumns({ meal: "DH/BH", supplemental: true })).toEqual({ meal: "DH/BH", supplemental: true });
    expect(legColumns({})).toEqual({ meal: null, supplemental: false });
  });
});
