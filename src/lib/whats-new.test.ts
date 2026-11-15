import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { WHATS_NEW, whatsNewDateLabel } from "@/lib/whats-new";

describe("What's new", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("heads an entry with its own date, whatever the device's clock", () => {
    // Auckland in November is +13: noon UTC is already the next day there.
    for (const zone of ["Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Honolulu", "America/Chicago"]) {
      process.env.TZ = zone;
      expect(whatsNewDateLabel("2026-11-08")).toMatch(/November 8, 2026|8 November 2026/);
    }
  });

  it("links every entry to a page that's there", () => {
    for (const e of WHATS_NEW.filter((e) => e.href)) expect(existsSync(`src/app${e.href === "/" ? "" : e.href}/page.tsx`), e.href).toBe(true);
  });

  it("gives each entry on a day its own title (the page keys them by it)", () => {
    const keys = WHATS_NEW.map((e) => `${e.date}|${e.title}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
