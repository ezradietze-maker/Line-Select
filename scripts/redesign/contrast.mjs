// Checks every text-on-background colour pair the site uses, in each appearance mode, against WCAG contrast:
// 4.5:1 for text, 3:1 for the calendar's graphic colours against the day cells they sit on (they also carry 10px
// labels, so they're held to 4.5:1 on the page surface too). Reads the token blocks straight out of globals.css.
//
//   node scripts/redesign/contrast.mjs [path/to/globals.css]
import { readFileSync } from "node:fs";

const css = readFileSync(process.argv[2] ?? new URL("../../src/app/globals.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const root = block(":root");
const modes = {
  day: root,
  night: { ...root, ...block(':root[data-theme="dark"]') },
  "red-light": { ...root, ...block(':root[data-theme="night"]') },
};
const chrome = block(':root:not([data-theme="night"]) .sidebar-scheme');
modes["chrome (sidebar)"] = { ...modes.night, ...chrome };

function hex(v, tokens, depth = 0) {
  if (depth > 5) return null;
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) return hex(tokens[ref[1]], tokens, depth + 1);
  const m = v.match(/^#([0-9a-f]{6})$/i);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const TEXT = ["ink", "ink-muted", "ink-faint"];
const SURFACES = ["canvas", "surface", "surface-raised", "panel"];
const pairs = [];
for (const t of TEXT) for (const s of SURFACES) pairs.push([t, s, 4.5]);
pairs.push(["on-brand", "brand", 4.5], ["on-danger", "danger", 4.5], ["on-wash", "accent-wash", 4.5]);
for (const s of ["canvas", "surface", "accent-soft"]) pairs.push(["accent", s, 4.5]);
for (const s of ["good", "warn", "danger", "sleep", "carry"]) pairs.push([s, `${s}-soft`, 4.5], [s, "surface", 4.5]);
for (const c of ["leg", "deadhead", "layover", "report", "gt", "rest", "chain"]) pairs.push([c, "surface", 4.5], [c, "canvas", 4.5]);
pairs.push(["focus-ring", "canvas", 3], ["focus-ring", "surface", 3]);

let failures = 0;
for (const [mode, tokens] of Object.entries(modes)) {
  const rows = [];
  for (const [fg, bg, min] of pairs) {
    if (mode.startsWith("chrome") && !["ink", "ink-muted", "ink-faint", "on-brand", "accent"].includes(fg)) continue;
    const a = hex(tokens[`--color-${fg}`] ?? "", tokens), b = hex(tokens[`--color-${bg}`] ?? "", tokens);
    if (!a || !b) continue;
    const r = ratio(a, b);
    if (r < min) { failures++; rows.push(`  FAIL ${fg} on ${bg}: ${r.toFixed(2)} (needs ${min})`); }
  }
  console.log(`${mode}: ${rows.length ? "\n" + rows.join("\n") : "all pairs pass"}`);
}
process.exit(failures ? 1 : 0);
