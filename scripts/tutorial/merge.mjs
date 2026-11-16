// Joins recordings into one chapter: node merge.mjs ch04 ch04a ch04b
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { at } from "./work.mjs";
const ROOT = at("rec");
const [out, ...parts] = process.argv.slice(2);
const frames = [], marks = [];
let offset = 0;
for (const p of parts) {
  const d = JSON.parse(readFileSync(join(ROOT, p, "frames.json"), "utf8"));
  const t0 = d.frames[0].t;
  for (const f of d.frames) frames.push({ file: join(ROOT, p, "frames", f.file), t: f.t - t0 + offset });
  for (const m of d.marks) marks.push({ id: m.id, t: Math.max(0, m.t - t0) + offset });
  offset = (d.end ? d.end - t0 + offset : frames.at(-1).t + 1) + 0.3;
}
const end = offset - 0.3;
mkdirSync(join(ROOT, out), { recursive: true });
writeFileSync(join(ROOT, out, "frames.json"), JSON.stringify({ frames, marks, end: end + frames[0].t }));
console.log(out, frames.length, "frames", marks.map((m) => `${m.id}@${m.t.toFixed(1)}`).join(" "));
