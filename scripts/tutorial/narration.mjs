// The narration, read straight from the approved script: each chapter's quoted paragraphs, in order.
import { readFileSync } from "node:fs";
export const SCRIPT = new URL("../../docs/tutorial/script.md", import.meta.url).pathname;
export function chapters() {
  const md = readFileSync(SCRIPT, "utf8");
  const out = [];
  for (const block of md.split(/\n## /).slice(1)) {
    const m = block.match(/^(\d+)\. (.+?) \(about/);
    if (!m) continue;
    const quoted = block.split("\n").filter((l) => l.startsWith(">")).map((l) => l.replace(/^>\s?/, ""));
    const paras = quoted.join("\n").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    out.push({ num: Number(m[1]), title: m[2], paras });
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let chars = 0;
  for (const c of chapters()) { const n = c.paras.join(" ").length; chars += n; console.log(c.num, c.title, c.paras.length, "paras", n, "chars", Math.round(c.paras.join(" ").split(/\s+/).length / 2.5), "s est"); }
  console.log("total chars", chars);
}
