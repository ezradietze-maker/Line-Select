import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .tsx under src/components. */
function screens(dir = "src/components"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return screens(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("an error shown after a press is read out", () => {
  it("every `{error && <p …text-danger…>{error}</p>}` is role=alert", () => {
    // A failed send, claim or dictation showed in red and said nothing: a screen reader heard the button come back,
    // and the pilot pressed again. A message shown after a press has to be read out the moment it shows.
    const silent = screens().flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/\{([\w.]*[eE]rror) && <p ([^>]*)>\{\1\}<\/p>\}/g)]
        .filter((m) => m[2].includes("text-danger") && !/role="(alert|status)"/.test(m[2]))
        // Said already, by the status the copy buttons share just below it.
        .filter((m) => !(path.endsWith("BidOrderExport.tsx") && m[1] === "calendarError"))
        .map((m) => `${path}: ${m[0]}`)
    );
    expect(silent).toEqual([]);
  });
});
