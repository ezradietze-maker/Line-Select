import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildPilotModel, type BuildModelInput } from "@/lib/brain/build-model";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { fitWeightsToChoices } from "@/lib/brain/fit-choices";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import type { PilotModel } from "@/types/pilot-model";
import { batched } from "./batch";
import { PERSONAS, simPilotContext } from "./personas";
import { cityRatingsFromLog } from "./trace";
import { lineAgreement, lineJudge, loadRun } from "./trip-scorecard";

/**
 * A brain change, tested on interviews already simulated: each transcript read fresh by the brain as committed (`--old`,
 * default HEAD) and by the brain in the working tree, and each reading scored against the simulated pilot's judge,
 * before and after fitting their line choices. Pairing the two brains on the same transcripts takes out the noise of
 * different interviews; single reads still vary, so `--reads` reads each transcript more than once.
 *
 * Cheaper than it was, for the same answer:
 * - Every read goes through the Batches API at half price (`scripts/eval/batch.ts`).
 * - The committed brain's reads are kept (.cache/eval/ab/, by the git hash of its build-model.ts) and reused: the same
 *   brain on the same transcript is the same experiment, so a later change compared against it pays only for the new
 *   brain's reads.
 *
 *   npx tsx scripts/eval/brain-ab.ts <persona>-<tag> [<persona>-<tag> …] [--reads N] [--old <git ref>]
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const reads = Math.max(1, Number(flag("reads") ?? 1));
const ref = flag("old") ?? "HEAD";
const DIR = ".cache/eval/ab";

type Build = (input: BuildModelInput) => ReturnType<typeof buildPilotModel>;

/** The committed brain, as a module beside this cache (its own imports pointed back at the app's). */
async function committedBrain(): Promise<{ build: Build; key: string }> {
  const key = execSync(`git rev-parse ${ref}:src/lib/brain/build-model.ts`, { encoding: "utf8" }).trim().slice(0, 12);
  const file = `${DIR}/build-model-${key}.ts`;
  if (!existsSync(file)) {
    mkdirSync(DIR, { recursive: true });
    const source = execSync(`git show ${ref}:src/lib/brain/build-model.ts`, { encoding: "utf8" }).replace(/from "\.\//g, 'from "@/lib/brain/');
    writeFileSync(file, source);
  }
  const mod = (await import(`../../${file}`)) as { buildPilotModel: Build };
  return { build: mod.buildPilotModel, key };
}

(async () => {
  process.loadEnvFile(".env.local");
  const old = await committedBrain();
  mkdirSync(DIR, { recursive: true });
  const jobs: { run: string; arm: "old" | "new"; i: number; task: () => Promise<PilotModel> }[] = [];
  const kept = new Map<string, PilotModel[]>();
  const ctx = new Map<string, { judge: NonNullable<ReturnType<typeof lineJudge>>; run: NonNullable<ReturnType<typeof loadRun>>; ratings: ReturnType<typeof cityRatingsFromLog> }>();

  for (const run of runs) {
    const persona = PERSONAS.find((p) => run.startsWith(`${p.id}-`));
    if (!persona) throw new Error(`Unknown run ${run}`);
    const r = loadRun(persona.id, run.slice(persona.id.length + 1))!;
    const exchanges = JSON.parse(readFileSync(`.cache/eval/sim/${run}.json`, "utf8")).exchanges;
    const ratings = cityRatingsFromLog(`.cache/eval/sim/${run}.txt`);
    ctx.set(run, { judge: lineJudge(persona.id)!, run: r, ratings });
    const input: BuildModelInput = { packBrief: buildPackBrief(r.pack, r.pm), pilotContext: simPilotContext(persona, r.pack), exchanges, prior: null, model: "claude-sonnet-5-5", effort: "high" };
    const stored = readdirSync(DIR).filter((f) => f.startsWith(`${run}-${old.key}-`)).map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as PilotModel);
    kept.set(run, stored.slice(0, reads));
    for (let i = stored.length; i < reads; i++)
      jobs.push({
        run, arm: "old", i,
        task: async () => {
          const m = (await old.build(input)).model;
          writeFileSync(`${DIR}/${run}-${old.key}-${Date.now()}-${i}.json`, JSON.stringify(m));
          return m;
        },
      });
    for (let i = 0; i < reads; i++) jobs.push({ run, arm: "new", i, task: async () => (await buildPilotModel(input)).model });
  }
  const reused = [...kept.values()].reduce((a, k) => a + k.length, 0);
  console.log(`${jobs.length} reads to make (${reused} of the committed brain's reused, key ${old.key})`);
  const { results, spend } = await batched(jobs.map((j) => j.task));

  const score = (run: string, raw: PilotModel) => {
    const c = ctx.get(run)!;
    const m = applyCityRatings(raw, c.ratings);
    const fitted = fitWeightsToChoices(c.run.pack, m, c.run.choices, c.run.pm).model;
    return { fresh: lineAgreement(c.run.pack, m, c.run.pm, c.judge), fit: lineAgreement(c.run.pack, fitted, c.run.pm, c.judge) };
  };
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const perPersona = new Map<string, { old: number[]; new: number[] }>();
  for (const run of runs) {
    const olds = [...kept.get(run)!, ...jobs.flatMap((j, k) => (j.run === run && j.arm === "old" && results[k].status === "fulfilled" ? [(results[k] as PromiseFulfilledResult<PilotModel>).value] : []))];
    const news = jobs.flatMap((j, k) => (j.run === run && j.arm === "new" && results[k].status === "fulfilled" ? [(results[k] as PromiseFulfilledResult<PilotModel>).value] : []));
    const o = olds.map((m) => score(run, m));
    const n = news.map((m) => score(run, m));
    console.log(`${run}: committed fit ${mean(o.map((x) => x.fit)).toFixed(3)} (fresh ${mean(o.map((x) => x.fresh)).toFixed(3)}) · working fit ${mean(n.map((x) => x.fit)).toFixed(3)} (fresh ${mean(n.map((x) => x.fresh)).toFixed(3)}) · reads ${o.length}/${n.length}`);
    const persona = PERSONAS.find((p) => run.startsWith(`${p.id}-`))!.id;
    const acc = perPersona.get(persona) ?? { old: [], new: [] };
    acc.old.push(...o.map((x) => x.fit));
    acc.new.push(...n.map((x) => x.fit));
    perPersona.set(persona, acc);
  }
  for (const [p, a] of perPersona) console.log(`  ${p}: ${mean(a.old).toFixed(3)} → ${mean(a.new).toFixed(3)}`);
  const failed = results.filter((x) => x.status === "rejected").length;
  console.log(`spend $${spend.toFixed(2)}${failed ? ` · ${failed} reads failed` : ""}`);
})();
