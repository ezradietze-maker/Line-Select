import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CALENDAR_ACCENT_PRESETS } from "@/lib/calendar-theme";

/** sRGB channel 0–1 to linear light, and back. */
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromHex = (hex: string) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));

/** OKLCH lightness of a hex color. */
function okL(hex: string): number {
  const [r, g, b] = fromHex(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** Relative luminance of an OKLCH color, clipped to sRGB. */
function luminanceOfOklch(L: number, C: number, hDeg: number): number {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const luminance = (hex: string) => {
  const [r, g, b] = fromHex(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);

describe("text on the calendar's own color", () => {
  // The rule as globals.css writes it: oklch(from accent clamp(lo, (flip - l) * 1000, hi) chroma hue).
  const css = readFileSync("src/app/globals.css", "utf8");
  const rule = css.match(/\.text-on-calendar \{[^}]*oklch\(from var\(--color-calendar-accent\) clamp\(([\d.]+), \(([\d.]+) - l\) \* 1000, ([\d.]+)\) ([\d.]+) ([\d.]+)\)/);
  it("is the rule this test reads", () => {
    expect(rule).not.toBeNull();
  });
  const [lo, flip, hi, chroma, hue] = (rule ?? []).slice(1).map(Number);
  const inkOn = (hex: string) => luminanceOfOklch(okL(hex) < flip ? hi : lo, chroma, hue);

  // Each theme's own calendar color (its brand: daylight, dark, night) and every color a pilot can pick.
  const colors = [
    ["daylight", "#0a1120"],
    ["dark", "#ffcc00"],
    ["night", "#d95757"],
    ...CALENDAR_ACCENT_PRESETS.flatMap((p) => (p.value ? [[p.label, p.value]] : [])),
  ];
  for (const [name, hex] of colors) {
    it(`reads at 4.5:1 or better on ${name} (${hex})`, () => {
      // The night red and Amber got light ink at 3.7:1 and 3.5:1: the trip numbers on every calendar day.
      expect(ratio(inkOn(hex), luminance(hex))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("prints a trip's credit at the ink's full strength", () => {
    // Faded to 85%, the credit beside the trip number fell under 4.5:1 on the night red, Amber and Teal.
    const faded = ["src/components/results/MiniLinePreview.tsx", "src/components/results/TripList.tsx", "src/components/interview/TripGlance.tsx"].filter((path) =>
      /<CreditHours[^>]*opacity-/.test(readFileSync(path, "utf8"))
    );
    expect(faded).toEqual([]);
  });
});
