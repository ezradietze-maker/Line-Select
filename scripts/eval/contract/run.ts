/**
 * Paid: asks the real model the test questions and scores the answers against the bar in the plan. Haiku at about a
 * quarter of a cent a question with nothing cached; Sonnet about four cents.
 *   npx tsx scripts/eval/contract/run.ts [file] [model] [--save tag]
 *
 * A citation is right when it lands on an expected piece or on something inside it. Made-up means a section the
 * index doesn't have reaching the pilot, which the validator must make impossible, so it's counted from the final answer.
 */
import fs from "node:fs";
import path from "node:path";
import { askContract } from "../../../src/lib/contract/ask";
import { contractNode } from "../../../src/lib/contract/index";
import { currentBidMonth } from "../../../src/lib/contract/phases";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].replace(/^"|"$/g, "");
}

interface Question {
  id: string;
  q: string;
  expect?: string[];
  notFound?: boolean;
  /** A follow-up: what the chat asked just before. */
  earlier?: { question: string; answer?: string; sections: string[] };
}

const args = process.argv.slice(2);
const saveAt = args.indexOf("--save");
const tag = saveAt >= 0 ? args[saveAt + 1] : null;
const [file = "scripts/eval/contract/dev-questions.json", model = "claude-haiku-5-5"] = args.filter((a, i) => !a.startsWith("--") && (saveAt < 0 || i !== saveAt + 1));
const quiet = file.includes("sealed");
const questions = JSON.parse(fs.readFileSync(file, "utf8")) as Question[];
const covers = (expected: string, id: string) => id === expected || id.startsWith(`${expected}.`);

async function one(q: Question) {
  const started = Date.now();
  const history = q.earlier ? [{ question: q.earlier.question, answer: q.earlier.answer ?? "", sections: q.earlier.sections }] : undefined;
  const r = await askContract({ question: q.q, bidMonth: currentBidMonth(), model, history });
  const cited = r.answer.found ? r.answer.quotes.map((x) => x.section) : [];
  const madeUp = cited.filter((id) => !contractNode(id));
  const right = q.notFound ? !r.answer.found : cited.some((id) => q.expect!.some((e) => covers(e, id)));
  return { id: q.id, q: q.q, expect: q.expect, notFound: !!q.notFound, right, found: r.answer.found, cited, madeUp, rejected: r.rejected, costUsd: r.usage.costUsd, inputTokens: r.usage.inputTokens, ms: Date.now() - started, answer: r.answer.answer, raw: r.raw };
}

async function main() {
  const results: Awaited<ReturnType<typeof one>>[] = [];
  const queue = [...questions];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let q = queue.shift(); q; q = queue.shift()) results.push(await one(q));
    }),
  );
  results.sort((a, b) => a.id.localeCompare(b.id));
  const answerable = results.filter((r) => !r.notFound);
  const absent = results.filter((r) => r.notFound);
  const cost = results.reduce((a, r) => a + r.costUsd, 0);
  for (const r of results) {
    if (r.right) continue;
    if (quiet) console.log(`WRONG ${r.id}${r.rejected ? " (validator rejected)" : ""}`);
    else console.log(`WRONG ${r.id} ${r.q}\n   want ${r.notFound ? "not found" : r.expect?.join(", ")}; cited ${r.cited.join(", ") || "none"}${r.rejected ? `\n   validator: ${r.rejected}` : ""}\n   ${r.answer.slice(0, 200)}`);
  }
  console.log(`${model}: right section ${answerable.filter((r) => r.right).length}/${answerable.length} (bar 90%); not found ${absent.filter((r) => r.right).length}/${absent.length} (bar 100%); made-up sections ${results.flatMap((r) => r.madeUp).length} (bar 0)`);
  console.log(`validator rejections ${results.filter((r) => r.rejected).length}; cost per question $${(cost / results.length).toFixed(5)}; total $${cost.toFixed(4)}; input tokens avg ${Math.round(results.reduce((a, r) => a + r.inputTokens, 0) / results.length)}; ms avg ${Math.round(results.reduce((a, r) => a + r.ms, 0) / results.length)}`);
  if (tag) {
    const out = path.join(".cache/eval/contract", `${tag}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    console.log(`saved ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
