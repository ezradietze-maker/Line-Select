import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WHAT_WE_READ } from "@/lib/fedex-connect/consent";

const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });

describe("the FedEx connection's terms", () => {
  it("name every screen one connection reads, as the panel on each says", () => {
    // The panel shows on Open Time and View/Add, and says one connection reads both: the terms said only open time.
    const read = WHAT_WE_READ.join(" ");
    expect(read).toMatch(/open-time list/);
    expect(read).toMatch(/View\/Add/);
  });

  it("are kept while it's coming soon: nothing in it calls FedEx, or anywhere but our own routes", () => {
    const code = [...filesIn("src/lib/fedex-connect"), ...filesIn("src/app/api/fedex"), ...filesIn("src/components/fedex-connect"), "src/lib/server/fedex-session.ts"];
    for (const file of code) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(text, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket/);
      for (const m of text.matchAll(/apiFetch\(\s*["'`]([^"'`]+)/g)) expect(m[1], file).toMatch(/^\/api\/fedex\//);
    }
  });
});
