import { readFileSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { BRAIN_PROMPT_VERSION, buildPilotModel } from "@/lib/brain/build-model";
import { pilotContextFor } from "@/lib/brain/context";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { describeCityRatings } from "@/lib/city-ratings";
import { migrateProfile } from "@/lib/profile-migration";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The ex-pilot's real interview, read again by the current brain: every answer he gave, in one full read, the way the
 * brain reads a finished interview. The result is saved as a copy of his profile with the new reading as the model he
 * confirmed, so `expilot-benchmark.ts --model <out>` scores it exactly as it scores his own.
 *
 * His city answer is put as his grades now stand (the city step's mix-up corrected, his Oct 21 answers added), since
 * those are what the app reads beside the interview. One brain call — about $0.50 at high effort.
 *
 *   npx tsx scripts/eval/expilot-replay.ts <tag> [--profile <profile.json>] [--pack <pack.json>]
 */

const DIR = "private/ex-pilot";
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  process.loadEnvFile(".env.local");
  const tag = process.argv[2];
  if (!tag || tag.startsWith("--")) throw new Error("Usage: expilot-replay.ts <tag> [--profile <profile.json>] [--pack <pack.json>]");
  const profilePath = arg("profile") ?? `${DIR}/benchmark-oct26/profile-oct21.json`;
  const pack = restoreBidPack(JSON.parse(readFileSync(arg("pack") ?? `${DIR}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
  const profile = migrateProfile(JSON.parse(readFileSync(profilePath, "utf8")) as PreferenceProfile);
  const exchanges = (profile.brainInterview?.exchanges ?? []).map((e) =>
    /layover city/i.test(e.question) && profile.cityRatings ? { ...e, answer: describeCityRatings(profile.cityRatings) } : e
  );
  if (!exchanges.length) throw new Error(`${profilePath} holds no interview.`);

  const r = await buildPilotModel({
    packBrief: buildPackBrief(pack),
    pilotContext: pilotContextFor(pack, { isCommuter: profile.isCommuter, commuteFrom: profile.commuteFrom, hasCrashPad: profile.hasCrashPad }),
    exchanges,
    effort: "high",
  });
  const out = `${DIR}/benchmark-oct26/replay-v${BRAIN_PROMPT_VERSION}-${tag}.json`;
  writeFileSync(out, JSON.stringify({ ...profile, brainInterview: { ...profile.brainInterview, reviewedModel: r.model }, replay: { brainVersion: BRAIN_PROMPT_VERSION, reasoning: r.reasoning, dropped: r.dropped, usage: r.usage } }, null, 1));

  const total = r.model.criteria.reduce((s, c) => s + c.weight, 0) || 1;
  console.log(`Brain v${BRAIN_PROMPT_VERSION} · ${r.usage.model} · $${r.usage.costUsd.toFixed(2)} · ${Math.round(r.usage.ms / 1000)}s → ${out}`);
  console.log(`Home: ${JSON.stringify(r.model.home)}`);
  for (const c of [...r.model.criteria].sort((a, b) => b.weight - a.weight))
    console.log(`  ${String(Math.round((100 * c.weight) / total)).padStart(3)}  ${c.metric.padEnd(26)} ${JSON.stringify(c.shape)}${c.hardLimit ? ` limit ${c.hardLimit.op} ${c.hardLimit.value}` : ""} — ${c.label}`);
  if (r.dropped.length) console.log(`Dropped: ${r.dropped.join(", ")}`);
})();
