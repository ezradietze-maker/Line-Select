import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { EXPILOT_MODEL } from "./expilot-model";

(async () => {
  if (!EXPILOT_MODEL) throw new Error("The reference model lives in .cache/eval/expilot-model.json, which isn't on this machine.");
  const pack = expandBidPack(JSON.parse(readFileSync(process.argv[2], "utf8")));
  const ranked = rankPackV2(pack, EXPILOT_MODEL);
  const fmt = (v: number | null, unit: string) => (v === null ? "—" : `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`);
  for (const r of [...ranked.slice(0, 8), ...ranked.slice(-3)]) {
    const top = [...r.results].sort((a, b) => b.contribution - a.contribution);
    const plus = top.slice(0, 3).map((x) => `${x.label}: ${fmt(x.value, x.unit)} (${x.contribution >= 0 ? "+" : ""}${x.contribution.toFixed(1)})`);
    const minus = top.slice(-2).map((x) => `${x.label}: ${fmt(x.value, x.unit)} (${x.contribution.toFixed(1)})`);
    console.log(`#${ranked.indexOf(r) + 1} line ${r.lineNumber} score ${r.score}${r.violations.length ? " CAPPED" : ""}`);
    console.log("   +", plus.join(" | "));
    console.log("   −", minus.join(" | "));
  }
})();
