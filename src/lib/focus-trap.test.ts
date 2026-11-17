import { describe, expect, it } from "vitest";
import { focusAfterChange, focusBackTo, focusHomeAfterLoss, inPlaceOf, nextStop, tabStops, type StopInfo } from "./focus-trap";

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

describe("focus on the ranked list when the control it was on goes away", () => {
  const listed = ["2295", "2112", "2192", "2105"];
  const at = (lost: { lineId?: string; chipId?: string; forLines?: boolean }, now: { listedNow?: string[]; lastLineId?: string | null; chipsBefore?: string[]; chipsNow?: string[] } = {}) =>
    focusHomeAfterLoss(
      { lineId: lost.lineId ?? null, chipId: lost.chipId ?? null, forLines: lost.forLines },
      { listedBefore: listed, listedNow: now.listedNow ?? listed, lastLineId: now.lastLineId ?? null, chipsBefore: now.chipsBefore ?? [], chipsNow: now.chipsNow ?? [] }
    );

  it("a line hidden or set aside from its own card: to the line now in its place", () => {
    expect(at({ lineId: "2112" }, { listedNow: ["2295", "2192", "2105"] })).toEqual({ line: "2192" });
  });

  it("the last line set aside: to the one above it", () => {
    expect(at({ lineId: "2105" }, { listedNow: ["2295", "2112", "2192"] })).toEqual({ line: "2192" });
  });

  it("the selection's bar, gone once its move is made: to the line last worked on", () => {
    expect(at({ forLines: true }, { lastLineId: "2192" })).toEqual({ line: "2192" });
  });

  it("the selection set aside from its bar: to the line now in the last one's place", () => {
    expect(at({ forLines: true }, { lastLineId: "2112", listedNow: ["2295", "2105"] })).toEqual({ line: "2105" });
  });

  it("a control that isn't about lines (the filters' Clear filters): the box it sat in, not the line last worked on", () => {
    // Sent to line 2192's card, off the screen, the Space the pilot scrolled with next opened it.
    expect(at({}, { lastLineId: "2192" })).toEqual({ near: true });
    expect(at({})).toEqual({ near: true });
  });

  it("a set-aside chip brought back: to the next chip, then Undo once none is left", () => {
    expect(at({ chipId: "2192" }, { chipsBefore: ["2192", "2105"], chipsNow: ["2105"] })).toEqual({ chip: "2105" });
    expect(at({ chipId: "2105" }, { chipsBefore: ["2105"], chipsNow: [] })).toEqual({ undo: true });
  });

  it("every line gone: to Undo; nothing worked on yet: nowhere", () => {
    expect(at({ lineId: "2295" }, { listedNow: [] })).toEqual({ undo: true });
    expect(at({ forLines: true })).toBeNull();
  });

  it("the one in a gone one's place reads past the others that went with it", () => {
    expect(inPlaceOf(listed, ["2295", "2105"], "2112")).toBe("2105");
    expect(inPlaceOf(listed, listed, "9999")).toBeNull();
  });
});

describe("focus after the page changed under the control that had it", () => {
  // The Trade Board's holding panel: "Confirm what I hold" opens the editor in its place; Cancel closes it again.
  const tree: Record<string, { connected: boolean; disabled?: boolean; stops: string[] }> = {
    confirmWhatIHold: { connected: false, stops: [] },
    panel: { connected: true, stops: ["heldLine", "confirm", "cancel"] },
    withdraw: { connected: true, disabled: true, stops: [] },
    card: { connected: true, stops: ["withdraw"] },
  };
  const after = (el: string, ancestors: string[]) =>
    focusAfterChange({ el, ancestors }, (e) => tree[e]?.connected ?? true, (e) => tree[e]?.disabled === true, (e) => tree[e]?.stops ?? []);

  it("goes to the first control of the box it was in when the control's gone", () => {
    expect(after("confirmWhatIHold", ["panel"])).toBe("heldLine");
  });

  it("waits while the control is greyed out working, and goes back to it once it's not", () => {
    expect(after("withdraw", ["card"])).toBeNull();
    tree.withdraw.disabled = false;
    expect(after("withdraw", ["card"])).toBe("withdraw");
  });
});
