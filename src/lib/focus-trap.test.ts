import { describe, expect, it } from "vitest";
import { nextStop, tabStops, type StopInfo } from "./focus-trap";

describe("Tab inside a dialog", () => {
  const stops = ["close", "field", "send"];

  it("goes round, either way, never out", () => {
    expect(nextStop(stops, "close", false)).toBe("field");
    expect(nextStop(stops, "send", false)).toBe("close");
    expect(nextStop(stops, "close", true)).toBe("send");
    expect(nextStop(stops, "field", true)).toBe("close");
  });

  it("comes in at the first stop, or the last going backwards, from anywhere outside them", () => {
    expect(nextStop(stops, null, false)).toBe("close");
    expect(nextStop(stops, "the page behind", true)).toBe("send");
    expect(nextStop([], null, false)).toBeNull();
  });

  it("stops once at each radio group: on its checked one, or its first", () => {
    const info: Record<string, StopInfo> = {
      close: {},
      yes1: { radioGroup: "q1" },
      no1: { radioGroup: "q1" },
      yes2: { radioGroup: "q2" },
      no2: { radioGroup: "q2", checked: true },
      send: {},
    };
    expect(tabStops(Object.keys(info), (k) => info[k])).toEqual(["close", "yes1", "no2", "send"]);
  });
});
