/**
 * How well the second reader (lib/brain/question-review.ts) sorts clunky questions from clear ones, on the owner's own
 * calls: the questions he flagged, the ones he approved, and recent simulated ones marked against his rules
 * (question-review-set.json, Nov 2026). It should send back every Bad one and pass every Good one.
 *
 *   npx tsx scripts/eval/review-bench.ts [--model claude-sonnet-5-5]
 */
import { readFileSync } from "node:fs";
import { reviewQuestion } from "@/lib/brain/question-review";

interface Item {
  id: number;
  verdict: "good" | "bad";
  from: string;
  kind?: string;
  prompt: string;
  help?: string;
  options?: string[];
  facts?: string[];
  why?: string;
}

const args = process.argv.slice(2);
const model = args[args.indexOf("--model") + 1];

(async () => {
  process.loadEnvFile(".env.local");
  const items: Item[] = JSON.parse(readFileSync("scripts/eval/question-review-set.json", "utf8"));
  let spend = 0;
  const results: { item: Item; ok: boolean; problem: string; rewrite: string }[] = [];
  for (let i = 0; i < items.length; i += 8) {
    const batch = await Promise.all(
      items.slice(i, i + 8).map(async (item) => {
        const r = await reviewQuestion({
          question: { prompt: item.prompt, helpText: item.help ?? "", options: item.options ?? [], questionKind: item.kind ?? "their-words", facts: item.facts ?? [] },
          answers: [],
          asked: [],
          ...(args.includes("--model") && model ? { model } : {}),
        });
        spend += r.usage.costUsd;
        return { item, ok: r.ok, problem: r.problem, rewrite: r.rewrite };
      })
    );
    results.push(...batch);
  }
  // The owner's own calls are in the reviewer's prompt as examples (review-examples.ts); the rest are held out, and
  // they're the fair measure.
  const tally = (rs: typeof results, name: string) => {
    const bad = rs.filter((r) => r.item.verdict === "bad");
    const good = rs.filter((r) => r.item.verdict === "good");
    console.log(`${name}: caught ${bad.filter((r) => !r.ok).length}/${bad.length} bad, sent back ${good.filter((r) => !r.ok).length}/${good.length} good`);
  };
  console.log(`model ${args.includes("--model") ? model : "default"} · $${spend.toFixed(4)}`);
  tally(results.filter((r) => r.item.from === "owner"), "  the owner's (in the prompt)");
  tally(results.filter((r) => r.item.from !== "owner"), "  held out");
  for (const r of results.filter((x) => x.item.verdict === "bad" && x.ok)) console.log(`  MISSED #${r.item.id} (${r.item.why}): ${r.item.prompt.slice(0, 110)}`);
  for (const r of results.filter((x) => x.item.verdict === "good" && !x.ok)) console.log(`  WRONGLY SENT BACK #${r.item.id}: ${r.problem.slice(0, 160)}`);
  for (const r of results.filter((x) => x.item.verdict === "bad" && !x.ok).slice(0, 6)) console.log(`  REWRITE #${r.item.id}: ${r.rewrite.slice(0, 200)}`);
})();
