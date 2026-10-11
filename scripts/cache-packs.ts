/**
 * Parses every bid pack PDF in a folder once and saves each seat as a
 * compact JSON file, so evaluation scripts can load real packs in a moment
 * instead of re-parsing PDFs. Usage: npx tsx scripts/cache-packs.ts <pdfDir> <outDir>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { compactBidPack } from "@/lib/bidpack-storage";
import { parseBidPackPdf } from "@/lib/pdf-parser";

(async () => {
  const [pdfDir, outDir] = process.argv.slice(2);
  if (!pdfDir || !outDir) throw new Error("usage: cache-packs <pdfDir> <outDir>");
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(pdfDir).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
    const r = await parseBidPackPdf(new Uint8Array(readFileSync(`${pdfDir}/${file}`)));
    for (const [seat, pack] of Object.entries(r.bidPacksBySeat)) {
      if (!pack) continue;
      const name = `${pack.month}-${pack.base}-${pack.aircraft}-${seat}.json`;
      writeFileSync(`${outDir}/${name}`, JSON.stringify(compactBidPack(pack)));
      console.log("saved", name, pack.lines.length, "lines");
    }
  }
})();
