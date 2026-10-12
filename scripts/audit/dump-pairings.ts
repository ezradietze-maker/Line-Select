/**
 * Dumps every pairing-schedule page of each bid pack PDF as the parser sees it
 * (two-column rows, in order) to .cache/raw/<pdf>.txt, every line-grid page to
 * .cache/raw/<pdf>.lines.txt, plus the parse warnings —
 * the raw material for auditing trips against the source.
 * Usage: npx tsx scripts/audit/dump-pairings.ts <pdfDir>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyPage } from "@/lib/pdf-parser/page-classifier";
import { extractPage, extractTwoColumnRows, groupIntoRows, loadPdf } from "@/lib/pdf-parser/text-extraction";
import { parseBidPackPdf } from "@/lib/pdf-parser";

(async () => {
  const dir = process.argv[2];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".pdf"))
    .sort()) {
    const data = new Uint8Array(readFileSync(`${dir}/${file}`));
    const doc = await loadPdf(data.slice());
    const out: string[] = [];
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await extractPage(doc, p);
      const rows = groupIntoRows(page.items);
      const kind = classifyPage(p, rows).kind;
      if (kind === "line-grid") lines.push(`=== PAGE ${p}`, ...rows);
      if (kind !== "pairing-schedule") continue;
      const { left, right } = extractTwoColumnRows(page);
      out.push(`=== PAGE ${p} LEFT`, ...left, `=== PAGE ${p} RIGHT`, ...right);
    }
    writeFileSync(`.cache/raw/${file.replace(".pdf", ".txt")}`, out.join("\n"));
    writeFileSync(`.cache/raw/${file.replace(".pdf", ".lines.txt")}`, lines.join("\n"));
    const r = await parseBidPackPdf(data.slice());
    writeFileSync(`.cache/raw/${file.replace(".pdf", ".warnings.json")}`, JSON.stringify(r.warnings, null, 1));
    console.log(file, "pairing rows", out.length, "warnings", r.warnings.length);
  }
})();
