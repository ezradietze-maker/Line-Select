import { describe, expect, it } from "vitest";
import { browserText, caretToKeep, serviceText, withDictated, type BrowserResult, type Turn } from "./assemble";

const r = (transcript: string, isFinal: boolean): BrowserResult => ({ isFinal, 0: { transcript } });
const said = (h: { settled: string; hearing: string }) => [h.settled, h.hearing].filter(Boolean).join(" ");

describe("serviceText", () => {
  it("replaces a turn with its latest copy instead of adding it again", () => {
    const turns = new Map<number, Turn>();
    turns.set(0, { text: "I like a double", final: false });
    turns.set(0, { text: "I like a double deadhead", final: false });
    turns.set(0, { text: "I like a double deadhead.", final: true });
    turns.set(1, { text: "Then a hub", final: false });
    expect(serviceText(turns)).toEqual({ settled: "I like a double deadhead.", hearing: "Then a hub" });
  });

  it("keeps turns in spoken order whatever order they arrive in", () => {
    const turns = new Map<number, Turn>([
      [2, { text: "three", final: true }],
      [0, { text: "one", final: true }],
      [1, { text: "two", final: true }],
    ]);
    expect(serviceText(turns).settled).toBe("one two three");
  });
});

describe("browserText", () => {
  it("rebuilds the session from all its results, so a resent result doesn't double", () => {
    const results = [r("I like long layovers", true), r(" in Honolulu", false)];
    expect(said(browserText(results))).toBe("I like long layovers in Honolulu");
  });

  it("handles Chrome on Android resending the whole sentence so far as each final", () => {
    const results = [r("I like", true), r("I like long", true), r("I like long layovers", true)];
    expect(browserText(results)).toEqual({ settled: "I like long layovers", hearing: "" });
  });

  it("drops a final Safari sends twice", () => {
    const results = [r("Hub turns wear me out.", true), r("hub turns wear me out", true), r("Give me a full day", false)];
    expect(said(browserText(results))).toBe("Hub turns wear me out. Give me a full day");
  });

  it("drops a still-changing piece that only repeats what's settled", () => {
    expect(browserText([r("three departures", true), r("three departures", false)])).toEqual({ settled: "three departures", hearing: "" });
    expect(browserText([r("three", true), r("three departures a month", false)])).toEqual({ settled: "", hearing: "three departures a month" });
  });
});

describe("withDictated", () => {
  it("puts one space between what was typed and what was said", () => {
    expect(withDictated("Typed first.", { settled: "Then said.", hearing: "" })).toBe("Typed first. Then said.");
    expect(withDictated("Typed first. ", { settled: "Then said.", hearing: "more" })).toBe("Typed first. Then said. more");
    expect(withDictated("", { settled: "", hearing: "" })).toBe("");
  });
});

describe("caretToKeep", () => {
  // A new value set on a box sends the cursor to its end (the browser's rule; Chrome, Nov 2026: the cursor at 8 of
  // "We like Memphis turns", the value set longer, the cursor at 37). A pilot who'd clicked back in to fix a word while
  // the mic was on had every letter they typed after the next dictated word land at the end.
  it("keeps a cursor the pilot put back inside the text", () => {
    expect(caretToKeep({ selectionStart: 8, selectionEnd: 8 }, true, 21)).toEqual({ start: 8, end: 8 });
    expect(caretToKeep({ selectionStart: 3, selectionEnd: 7 }, true, 21)).toEqual({ start: 3, end: 7 });
  });

  it("lets a cursor at the end follow the words, and leaves a box the pilot isn't in alone", () => {
    expect(caretToKeep({ selectionStart: 21, selectionEnd: 21 }, true, 21)).toBeNull();
    expect(caretToKeep({ selectionStart: 8, selectionEnd: 8 }, false, 21)).toBeNull();
  });
});
