import { readFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { prepareMetrics } from "@/lib/metrics/compute";
import { pickQuestionExamples } from "@/lib/brain/question-examples";
import { pickTopics } from "@/lib/brain/question-topics";
for (const [packId, run] of [["OCT26-ANC-B777-FO", "anc-777fo-sea-commuter-examples1"], ["OCT26-MEM-MD11-CAP", "expilot-mem-plain1"]]) {
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${packId}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const steps = JSON.parse(readFileSync(`.cache/eval/sim/${run}.steps.json`, "utf8"));
  const model = steps[0].input.model;
  const ex = pickQuestionExamples(pack, model, pm);
  const t0 = performance.now();
  const r = pickTopics(pack, model, pm, {}, ex, 6);
  console.log(run, `${(performance.now() - t0).toFixed(0)}ms`);
  for (const t of r.topics) console.log(" ", t.moves, t.id, t.feature ? `feature:${t.feature.label}` : t.priorities.join(" / "), t.exampleIds.map((id) => { const e = r.examples.find((x) => x.id === id)!; return `${e.title} ${e.fact}`; }).join("; "));
}
