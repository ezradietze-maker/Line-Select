/**
 * Accuracy on a big pack without judging all 300–500 lines: the judge tiers a
 * sample (each system's top 15, plus random lines from the rest), and both
 * rankings — the new interview's model and today's live scoring from the same
 * story — are scored on it.
 *
 * Usage: npx tsx scripts/eval/judge-sample.ts <persona-id> [sim-tag]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { computeBidPackGroundingStats } from "@/lib/interview-grounding";
import { applyProfileUpdates, finalizeAdaptiveProfile } from "@/lib/interview-engine";
import { storyCitySentiments } from "@/lib/interview-story";
import { runBiddingStoryExtraction } from "@/lib/interview-turn-service";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { rankLayoverCitiesByFrequency, rankLines } from "@/lib/scoring";
import { rankPackV2 } from "@/lib/scoring-v2/score";
import type { BiddingStoryResponse } from "@/types/interview-session";
import type { PilotModel } from "@/types/pilot-model";
import { judgePack } from "./judge";
import { scorecard } from "./metrics";
import { pilotWordsOf, PERSONAS } from "./personas";

(async () => {
  process.loadEnvFile(".env.local");
  const persona = PERSONAS.find((p) => p.id === process.argv[2])!;
  const tag = process.argv[3] ?? "run1";
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const sim = JSON.parse(readFileSync(`.cache/eval/sim/${persona.id}-${tag}.json`, "utf8")) as { model: PilotModel };
  const v2 = rankPackV2(pack, sim.model).map((r) => r.lineNumber);

  // Today's live scoring from the same story.
  const storyFile = `.cache/eval/story-${persona.id}.json`;
  let extraction: BiddingStoryResponse;
  if (existsSync(storyFile)) extraction = JSON.parse(readFileSync(storyFile, "utf8"));
  else {
    const r = await runBiddingStoryExtraction(process.env.ANTHROPIC_API_KEY!, { bidStoryText: persona.story, grounding: computeBidPackGroundingStats(pack), base: pack.base, aircraft: pack.aircraft, isCommuter: persona.isCommuter, cityCodes: rankLayoverCitiesByFrequency(pack).map((c) => c.code) });
    if (!r.ok) throw new Error("story extraction failed");
    extraction = r as unknown as BiddingStoryResponse;
    writeFileSync(storyFile, JSON.stringify(extraction));
  }
  const facts = applyProfileUpdates([], extraction.profileUpdates);
  const profile = finalizeAdaptiveProfile({ facts, transcript: [], isCommuter: persona.isCommuter, hasCrashPad: null, commuteFrom: persona.commuteFrom, cityPreferencesSeed: storyCitySentiments(facts) });
  const v1 = rankLines(pack, profile, {}, computeImplicitLineValues(pack)).map((s) => s.line.lineNumber);

  // The sample: both systems' top 15, then a seeded random draw from everything else.
  const picked = new Set([...v2.slice(0, 15), ...v1.slice(0, 15)]);
  let seed = 11;
  const rest = pack.lines.map((l) => l.lineNumber).filter((n) => !picked.has(n));
  while (picked.size < 75 && rest.length) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    picked.add(rest.splice(seed % rest.length, 1)[0]);
  }
  const sample = pack.lines.filter((l) => picked.has(l.lineNumber));
  const judgment = await judgePack({ pack, pilotWords: pilotWordsOf(persona), pilotContext: persona.context, cacheFile: `.cache/eval/judge-sample-${persona.id}.json`, lines: sample });
  console.log(`judge on ${sample.length} of ${pack.lines.length} lines ($${judgment.costUsd.toFixed(2)}): ${judgment.reasoning}`);
  const only = (o: string[]) => o.filter((l) => picked.has(l));
  console.table([scorecard("live site today (v1)", only(v1), judgment), scorecard("new interview (v2)", only(v2), judgment)]);
})();
