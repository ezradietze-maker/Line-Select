/**
 * Free: does retrieval hand the model the right section? No model call, so it can run on every change to the search.
 *   npx tsx scripts/eval/contract/recall.ts [file] [budgetChars]
 */
import fs from "node:fs";
import { contractNode } from "../../../src/lib/contract/index";
import { retrievePassages, searchPieces } from "../../../src/lib/contract/retrieve";

interface Question {
  id: string;
  q: string;
  expect?: string[];
  notFound?: boolean;
}

const file = process.argv[2] ?? "scripts/eval/contract/dev-questions.json";
const budget = Number(process.argv[3] ?? 40000);
const questions = JSON.parse(fs.readFileSync(file, "utf8")) as Question[];
const covers = (passage: string, id: string) => id === passage || id.startsWith(`${passage}.`);

let hit = 0;
let total = 0;
for (const q of questions) {
  if (!q.expect) continue;
  total++;
  for (const id of q.expect) if (!contractNode(id)) console.log(`  ${q.id}: no piece ${id}`);
  const { passages } = retrievePassages(q.q, budget);
  const found = q.expect.some((id) => passages.some((p) => covers(p, id) || covers(id, p)));
  if (found) hit++;
  else console.log(`MISS ${q.id} ${q.q}\n   want ${q.expect.join(", ")}\n   got ${passages.slice(0, 8).join(", ")}\n   top ${searchPieces(q.q, 5).map((h) => h.id).join(", ")}`);
}
console.log(`${hit}/${total} right section retrieved at ${budget} chars`);
