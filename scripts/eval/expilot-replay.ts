import { readFileSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { BRAIN_PROMPT_VERSION, buildPilotModel } from "@/lib/brain/build-model";
import { batched } from "./batch";
import { pilotContextFor } from "@/lib/brain/context";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { minHomeHoursSentence } from "@/components/interview/MinHomeHoursPicker";
import { describeCityRatings } from "@/lib/city-ratings";
import { migrateProfile } from "@/lib/profile-migration";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * The ex-pilot's real interview, read again by the current brain: every answer he gave, in one full read, the way the
 * brain reads a finished interview. The result is saved as a copy of his profile with the new reading as the model he
 * confirmed, so `expilot-benchmark.ts --model <out>` scores it exactly as it scores his own.
 *
 * His city answer is put as his grades now stand (the city step's mix-up corrected, his Oct 21 answers added), since
 * those are what the app reads beside the interview. One read is about $0.15–0.20 at high effort.
 *
 * Several reads (`--reads N`, saved as <tag>-1 … <tag>-N) go together: with `--batch`, through the Message Batches API
 * at half price, the interview cached between them (`scripts/eval/batch.ts`); without it, the first read runs alone so
 * the rest read its cache instead of each paying to write it.
 *
 *   npx tsx scripts/eval/expilot-replay.ts <tag> [--reads N] [--batch] [--profile <profile.json>] [--pack <pack.json>]
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
  // His answers as the interview now records them: the commute step with his hours-at-home answer, the city step as his grades stand.
  const exchanges = (profile.brainInterview?.exchanges ?? []).map((e) =>
    /layover city/i.test(e.question) && profile.cityRatings
      ? { ...e, answer: describeCityRatings(profile.cityRatings) }
      : /commute to base/i.test(e.question) && profile.minHomeHours && !e.answer.includes("at home")
        ? { ...e, answer: e.answer + minHomeHoursSentence(profile.minHomeHours) }
        : e
  );
  if (!exchanges.length) throw new Error(`${profilePath} holds no interview.`);

  const input = {
    packBrief: buildPackBrief(pack),
    pilotContext: pilotContextFor(pack, { isCommuter: profile.isCommuter, commuteFrom: profile.commuteFrom, hasCrashPad: profile.hasCrashPad, minHomeHours: profile.minHomeHours }),
    exchanges,
    effort: "high" as const,
  };
  const reads = Math.max(1, Number(arg("reads") ?? 1));
  const tags = reads === 1 ? [tag] : Array.from({ length: reads }, (_, i) => `${tag}-${i + 1}`);

  const readOnce = async (t: string) => {
    const r = await buildPilotModel(input);
    const out = `${DIR}/benchmark-oct26/replay-v${BRAIN_PROMPT_VERSION}-${t}.json`;
    writeFileSync(out, JSON.stringify({ ...profile, brainInterview: { ...profile.brainInterview, reviewedModel: r.model }, replay: { brainVersion: BRAIN_PROMPT_VERSION, reasoning: r.reasoning, dropped: r.dropped, usage: r.usage } }, null, 1));
    console.log(`Brain v${BRAIN_PROMPT_VERSION} · ${r.usage.model} · $${r.usage.costUsd.toFixed(3)} → ${out}`);
    if (reads === 1) {
      const total = r.model.criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
      console.log(`Home: ${JSON.stringify(r.model.home)}`);
      for (const c of [...r.model.criteria].sort((a, b) => b.weight - a.weight))
        console.log(`  ${String(Math.round((100 * c.weight) / total)).padStart(3)}  ${c.metric.padEnd(26)} ${JSON.stringify(c.shape)}${c.hardLimit ? ` limit ${c.hardLimit.op} ${c.hardLimit.value}` : ""} — ${c.label}`);
      if (r.dropped.length) console.log(`Dropped: ${r.dropped.join(", ")}`);
    }
    return r.usage.costUsd;
  };

  if (process.argv.includes("--batch")) {
    const { results, spend, rounds } = await batched(tags.map((t) => () => readOnce(t)), { cacheFresh: true });
    const failed = results.filter((x) => x.status === "rejected").length;
    console.log(`${tags.length - failed} of ${tags.length} reads in ${rounds} batch round${rounds === 1 ? "" : "s"} · $${spend.toFixed(2)}${failed ? ` · ${failed} failed` : ""}`);
  } else {
    // The first read writes the cache; the rest, started together after it, read it.
    let spend = await readOnce(tags[0]);
    spend += (await Promise.all(tags.slice(1).map(readOnce))).reduce((a, b) => a + b, 0);
    console.log(`${tags.length} read${tags.length === 1 ? "" : "s"} · $${spend.toFixed(2)}`);
  }
})();
