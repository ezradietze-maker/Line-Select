import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PAGES, SAVED_STATE_SCREENS, waitsForSavedState } from "./site-pages";

/** Every top-level page in the app, as its path. */
function topLevelPages(): string[] {
  const app = join(process.cwd(), "src/app");
  return readdirSync(app, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "api" && existsSync(join(app, d.name, "page.tsx")))
    .map((d) => `/${d.name}`);
}

describe("which pages wait for saved state", () => {
  it("knows every page: a new one has to be put on one list or the other", () => {
    const known = [...PUBLIC_PAGES, ...SAVED_STATE_SCREENS] as string[];
    expect(topLevelPages().filter((p) => !known.includes(p))).toEqual([]);
    expect(PUBLIC_PAGES.filter((p) => (SAVED_STATE_SCREENS as readonly string[]).includes(p))).toEqual([]);
  });

  it("draws the public pages and a wrong link straight away", () => {
    for (const p of PUBLIC_PAGES) expect(waitsForSavedState(p)).toBe(false);
    expect(waitsForSavedState("/no-such-page")).toBe(false);
    expect(waitsForSavedState("/")).toBe(false);
  });

  it("holds the pilot's own screens, nested ones included, until their pack and profile have loaded", () => {
    expect(waitsForSavedState("/results")).toBe(true);
    expect(waitsForSavedState("/preferences/quick")).toBe(true);
    expect(waitsForSavedState("/auth")).toBe(true);
  });
});
