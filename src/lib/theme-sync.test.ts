import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followThemeFromOtherTabs, THEME_CHANGE_EVENT, type ThemeMode } from "@/lib/theme";

/** One tab: its storage (shared with the other tab, as a browser's is), its window's events, and its <html> attributes. */
const store = new Map<string, string>();
const attrs = new Map<string, string>();
let win: EventTarget & { localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> };

beforeEach(() => {
  store.clear();
  attrs.clear();
  win = Object.assign(new EventTarget(), {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) } });
});
afterEach(() => vi.unstubAllGlobals());

/** What the browser fires in this tab when another tab writes the key. */
function otherTabSets(key: string | null, value: string | null) {
  if (key && value !== null) store.set(key, value);
  else if (key) store.delete(key);
  else store.clear();
  win.dispatchEvent(Object.assign(new Event("storage"), { key }));
}

describe("the theme, across tabs", () => {
  it("follows a theme chosen in another tab, and tells this tab's menus", () => {
    const told: ThemeMode[] = [];
    win.addEventListener(THEME_CHANGE_EVENT, (e) => told.push((e as CustomEvent<ThemeMode>).detail));
    const stop = followThemeFromOtherTabs();
    otherTabSets("line-select:theme:v1", "night");
    expect(attrs.get("data-theme")).toBe("night");
    otherTabSets("line-select:theme:v1", "system");
    expect(attrs.has("data-theme")).toBe(false);
    // Another key changing leaves the theme be.
    otherTabSets("line-select:time-mode:v1", "zulu");
    expect(told).toEqual(["night", "system"]);
    stop();
    otherTabSets("line-select:theme:v1", "dark");
    expect(attrs.has("data-theme")).toBe(false);
  });
});
