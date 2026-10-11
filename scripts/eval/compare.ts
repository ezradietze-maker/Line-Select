/**
 * How close each ranking lands to the judge's: today's scoring (v1, from
 * the profile the live app builds out of the pilot's story) and scoring v2
 * (from a pilot model). Prints the scorecard.
 *
 * Usage: npx tsx scripts/eval/compare.ts <persona-id>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { applyProfileUpdates, finalizeAdaptiveProfile } from "@/lib/interview-engine";
import { storyCitySentiments } from "@/lib/interview-story";
import { runBiddingStoryExtraction } from "@/lib/interview-turn-service";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { rankLines, rankLayoverCitiesByFrequency } from "@/lib/scoring";
import { buildPilotModel, type BuildModelResult } from "@/lib/brain/build-model";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { BRAIN_MODEL } from "@/lib/brain/llm";
import { BRAIN_PROMPT_VERSION } from "@/lib/brain/build-model";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { BiddingStoryResponse } from "@/types/interview-session";
import { judgePack } from "./judge";
import { scorecard } from "./metrics";
import { PERSONAS } from "./personas";

async function v1Order(pack: BidPack, story: string, isCommuter: boolean, commuteFrom: string | null, cacheFile: string): Promise<string[]> {
  let extraction: BiddingStoryResponse;
  if (existsSync(cacheFile)) extraction = JSON.parse(readFileSync(cacheFile, "utf8"));
  else {
    const r = await runBiddingStoryExtraction(process.env.ANTHROPIC_API_KEY!, {
      bidStoryText: story,
      grounding: computeBidPackGroundingStats(pack),
      base: pack.base,
      aircraft: pack.aircraft,
      isCommuter,
      cityCodes: rankLayoverCitiesByFrequency(pack).map((c) => c.code),
    });
    if (!r.ok) throw new Error("story extraction failed");
    extraction = r as unknown as BiddingStoryResponse;
    writeFileSync(cacheFile, JSON.stringify(extraction));
  }
  const facts = applyProfileUpdates([], extraction.profileUpdates);
  const profile = finalizeAdaptiveProfile({ facts, transcript: [], isCommuter, hasCrashPad: null, commuteFrom, cityPreferencesSeed: storyCitySentiments(facts) });
  return rankLines(pack, profile, {}, computeImplicitLineValues(pack)).map((s) => s.line.lineNumber);
}

(async () => {
  process.loadEnvFile(".env.local");
  const persona = PERSONAS.find((p) => p.id === process.argv[2]);
  if (!persona) throw new Error(`unknown persona; one of ${PERSONAS.map((p) => p.id).join(", ")}`);
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  mkdirSync(".cache/eval", { recursive: true });

  const judgment = await judgePack({ pack, pilotWords: persona.story, pilotContext: persona.context, cacheFile: `.cache/eval/judge-${persona.id}.json` });
  console.log(`judge (${judgment.costUsd.toFixed(2)} USD): ${judgment.reasoning}\n  top: ${judgment.top.map((t) => t.line).join(", ")}`);

  const rows = [scorecard("v1 today (from story)", await v1Order(pack, persona.story, persona.isCommuter, persona.commuteFrom, `.cache/eval/story-${persona.id}.json`), judgment)];
  if (persona.referenceModel) rows.push(scorecard("v2 (reference model)", rankPackV2(pack, persona.referenceModel).map((r) => r.lineNumber), judgment));

  // The brain, from the opening story alone — what the interview would know after turn 0.
  const brainFile = `.cache/eval/brain-${persona.id}-${BRAIN_MODEL}-v${BRAIN_PROMPT_VERSION}.json`;
  let brain: BuildModelResult;
  if (existsSync(brainFile)) brain = JSON.parse(readFileSync(brainFile, "utf8"));
  else {
    brain = await buildPilotModel({
      packBrief: buildPackBrief(pack),
      pilotContext: persona.context,
      exchanges: [{ turn: 0, question: "Walk us through how you bid, start to finish, in your own words.", answer: persona.story }],
    });
    writeFileSync(brainFile, JSON.stringify(brain, null, 2));
  }
  console.log(`\nbrain (${brain.usage.model}, ${brain.usage.costUsd.toFixed(2)} USD, ${(brain.usage.ms / 1000).toFixed(0)}s): ${brain.model.synopsis}`);
  console.log(`  home: ${JSON.stringify(brain.model.home)}`);
  for (const c of [...brain.model.criteria].sort((a, b) => b.weight - a.weight))
    console.log(`  ${c.weight.toFixed(2)} ${c.tier.padEnd(6)} ${c.label} — ${c.metric}${c.params ? " " + JSON.stringify(c.params) : ""} ${JSON.stringify(c.shape)}${c.hardLimit ? " LIMIT " + JSON.stringify(c.hardLimit) : ""}`);
  if (brain.dropped.length) console.log("  dropped:", brain.dropped);
  for (const t of brain.model.threads) console.log(`  thread ${t.priority.toFixed(2)} [${t.status}] ${t.topic} — ${t.why}`);
  for (const n of brain.model.notMeasurable) console.log(`  not measurable: ${n.statement}`);
  rows.push(scorecard("v2 (brain, story only)", rankPackV2(pack, brain.model).map((r) => r.lineNumber), judgment));

  console.table(rows);
})();
