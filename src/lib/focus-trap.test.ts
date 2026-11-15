import { describe, expect, it } from "vitest";
import { focusBackTo, nextStop, tabStops, type StopInfo } from "./focus-trap";

describe("focus after a dialog closes", () => {
  // The FedEx panel after "Accept and connect": the Connect button that opened the consent is gone, the row it sat in
  // is left with only words, and the panel around it now holds Disconnect.
  const tree: Record<string, { connected: boolean; stops: string[] }> = {
    connect: { connected: false, stops: [] },
    row: { connected: true, stops: [] },
    panel: { connected: true, stops: ["disconnect", "audit"] },
    page: { connected: true, stops: ["nav", "disconnect", "audit"] },
  };
  const back = (opener: string | null, ancestors: string[]) =>
    focusBackTo(opener, ancestors, (el) => tree[el]?.connected ?? true, (el) => tree[el]?.stops ?? []);

  it("goes back to what opened it while it's there", () => {
    expect(back("row", ["panel"])).toBe("row");
  });

  it("goes to the nearest control still there when the opener's gone, not to the page", () => {
    expect(back("connect", ["row", "panel", "page"])).toBe("disconnect");
  });

  it("goes nowhere when nothing near it can take focus", () => {
    expect(back("connect", ["row"])).toBeNull();
  });
});

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
