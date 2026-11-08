/**
 * Builds src/lib/contract/cba-2026.json from the full-language 2026 agreement PDF: every numbered piece of the contract
 * with its printed page, its 2026 words, its 2015 words where they changed, and the Implementation LOA's phase chart.
 *
 *   npx tsx scripts/contract/build-index.ts
 *
 * The PDF is the source, not the .txt beside it: the plain text runs deleted and new words together.
 */
import fs from "node:fs";
import path from "node:path";
import { readPdf } from "./extract-pdf";
import { parseChart } from "./parse-chart";
import { parseAgreement } from "./parse-sections";

const SOURCE = "private/contract/2026/pdf/00-full-tentative-agreement.pdf";
const OUT = "src/lib/contract/cba-2026.json";
/** PDF pages of the chart in the agreement's Implementation LOA, Appendix A (printed pages 289–292). */
const CHART_PAGES = [291, 292, 293, 294];

async function main() {
  const pages = await readPdf(SOURCE);
  const { docs, nodes, rejected } = parseAgreement(pages);
  const chart = parseChart(pages.filter((p) => CHART_PAGES.includes(p.pageNumber)));
  const ids = new Set(nodes.map((n) => n.id));
  const unmatched = chart.flatMap((row) => row.refs.filter((r) => !ids.has(r)).map((r) => `${r} (${row.summary})`));

  const json = {
    source: "Tentative Agreement 2026, full language (ratified June 9, 2026; effective June 29, 2026)",
    docs,
    nodes: nodes.map(({ doc, ...n }) => ({ ...n, doc })),
    chart,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(json)}\n`);

  console.log(`${nodes.length} pieces in ${docs.length} parts, ${chart.length} chart rows, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
  console.log(`${rejected.length} marker-like lines kept as running text:\n  ${rejected.join("\n  ")}`);
  console.log(`${unmatched.length} chart references with no piece of that number:\n  ${unmatched.join("\n  ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
