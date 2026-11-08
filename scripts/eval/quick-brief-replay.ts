import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { buildPilotModel } from "@/lib/brain/build-model";
import { pilotContextFor } from "@/lib/brain/context";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { quickBriefExchanges } from "@/lib/brain/quick-brief";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import { batched } from "./batch";

/**
 * How well a quick brief ranks a real pilot's month, against the one pilot whose opinion we have: the ex-pilot called
 * his top four lines (1003, 1005, 1010, 1011, MD-11 Memphis captains, October 2026) great. The bar, agreed with the
 * owner Nov 7, 2026: all four inside the quick brief's top 15 of 49 on at least 6 of 8 reads.
 *
 * The brief itself is written from his Oct 15 story and fixed in QUICK_BRIEF below, before any read: tuning it to the
 * answer would prove nothing.
 *
 * Measured Nov 8, 2026: 8 of 8, all four in his top 6. Controls, two reads each: his chips without the sentence, and the
 * commuter starting point from SAN, also pass (top 7); three other pilots' briefs living locally all fail (rested, earn,
 * family: as low as #47). So it tells his brief from others'. But the top 15 alone is a low bar on this pack: plain line
 * number order passes it too (#3, #5, #10, #11), so judge by how near the top they land, and by the controls.
 *
 *   npx tsx scripts/eval/quick-brief-replay.ts [--reads 8] [--batch] [--tag name]
 *
 * Reads are saved to .cache/eval/quick-brief/ and scored again free with --rescore. A live read (no --batch) is what a
 * pilot pays for, so it's the cost to quote; batched reads are half price.
 */

const GREAT = ["1003", "1005", "1010", "1011"];
const TOP = 15;
const QUICK_BRIEF = {
  chips: ["easy-commute", "few-departures", "pay-per-day", "few-legs", "layovers", "no-hub-turns"],
  sentence: "I live in San Diego. West Coast and Pacific deadheads are great for me, and lifestyle comes ahead of pay. Hawaii, Seattle and Los Angeles are my favorite layovers, and I don't like Guangzhou or Newark.",
  dates: "",
};
const WHO = { isCommuter: true, commuteFrom: "SAN", hasCrashPad: null };
const PACK = "private/ex-pilot/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json";
const DIR = ".cache/eval/quick-brief";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  process.loadEnvFile(".env.local");
  const tag = arg("tag") ?? "run";
  const reads = Math.max(1, Number(arg("reads") ?? 8));
  const pack = restoreBidPack(JSON.parse(readFileSync(PACK, "utf8")));
  const exchanges = quickBriefExchanges(QUICK_BRIEF);
  const path = (i: number) => `${DIR}/${tag}-${i + 1}.json`;

  if (!process.argv.includes("--rescore")) {
    const input = { packBrief: buildPackBrief(pack), pilotContext: pilotContextFor(pack, WHO), exchanges, effort: "high" as const };
    const readOnce = async (i: number) => {
      const r = await buildPilotModel(input);
      writeFileSync(path(i), JSON.stringify({ model: r.model, usage: r.usage, dropped: r.dropped }));
      console.log(`read ${i + 1}: $${r.usage.costUsd.toFixed(3)}, ${(r.usage.ms / 1000).toFixed(0)} s, ${r.model.criteria.length} priorities`);
      return r.usage.costUsd;
    };
    const tasks = Array.from({ length: reads }, (_, i) => i);
    if (process.argv.includes("--batch")) {
      const { spend, rounds } = await batched(tasks.map((i) => () => readOnce(i)), { cacheFresh: true });
      console.log(`${reads} reads in ${rounds} batch round${rounds === 1 ? "" : "s"} · $${spend.toFixed(2)}`);
    } else {
      // Live, one at a time: the first pays to write the pack's cache, as a pilot's first read does.
      for (const i of tasks) await readOnce(i);
    }
  }

  let met = 0;
  let scored = 0;
  for (let i = 0; existsSync(path(i)); i++) {
    const { model } = JSON.parse(readFileSync(path(i), "utf8"));
    const order = rankPackV2(pack, model).map((r) => r.lineNumber);
    const ranks = GREAT.map((n) => order.indexOf(n) + 1);
    const ok = ranks.every((r) => r > 0 && r <= TOP);
    scored++;
    if (ok) met++;
    console.log(`read ${i + 1}: ${GREAT.map((n, j) => `${n} #${ranks[j]}`).join("  ")}  ${ok ? "in" : "OUT"}  top 5: ${order.slice(0, 5).join(" ")}`);
  }
  console.log(`\nAll four in the top ${TOP}: ${met} of ${scored} reads. Bar: at least 6 of 8.`);
})();
