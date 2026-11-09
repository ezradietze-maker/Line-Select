import { describe, expect, it } from "vitest";
import { namedDomicile } from "./domicile-name";

describe("namedDomicile", () => {
  it("says the city where the words say the domicile", () => {
    expect(namedDomicile("Earliest report at the domicile", "MEM")).toBe("Earliest report in Memphis");
    expect(namedDomicile("Nights in the domicile city", "MEM")).toBe("Nights in Memphis");
    expect(namedDomicile("Commutes to or from the domicile", "IND")).toBe("Commutes to or from Indianapolis");
    expect(namedDomicile("The domicile's clock", "MEM")).toBe("Memphis's clock");
  });

  it("leaves the words alone with no city to say", () => {
    expect(namedDomicile("Nights in the domicile city", null)).toBe("Nights in the domicile city");
    expect(namedDomicile("Nights in the domicile city", "ZZZ")).toBe("Nights in the domicile city");
    expect(namedDomicile("Days off", "MEM")).toBe("Days off");
  });
});
