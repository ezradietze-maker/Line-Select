import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { migrateProfile } from "@/lib/profile-migration";
import { type V2LineScore } from "@/lib/scoring-v2/score";
import { rankLinesWithTrips, scoreTripsV2 } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The ex-pilot's Nov 18 interview on the 777 Captain October pack, as a benchmark: his four line picks and his trip pick
 * (each "easily" or "just"), and the rules he gave in his own words — about two departures a month ideal, three
 * "starting to push it", trips over 7 to 9 days avoided. Checked with the model the site ranks him with now (his saved
 * `pilotModel`, after his picks and drags) and with the one saved when he finished the interview (`reviewedModel`).
 *
 * Free to run (no AI calls). His profile and pack stay in the gitignored private folder; this script only reads them.
 *
 *   npx tsx scripts/eval/expilot-nov18.ts [--pack <pack.json>] [--profile <profile.json>] [--out <result.md>]
 */

const DIR = "private/ex-pilot/interview-export-2026-11-18";
const DEFAULTS = { pack: ".cache/packs/OCT26-MEM-B777-CAP.json", profile: `${DIR}/profile.json` };

/** His line picks: [the line he bid higher, the other one, how strongly]. */
const LINE_PICKS: [string, string, "easily" | "just"][] = [
  ["1116", "1279", "easily"],
  ["1177", "1271", "easily"],
  ["1125", "1121", "easily"],
  ["1052", "1142", "just"],
];
/** His trip pick, by pairing number and start day: trip 128 on Oct 21 over trip 311 on Oct 20, "just". */
const TRIP_PICK = { preferred: "p-83-128-DL1666-45@23", other: "p-147-311-UA0247-15@22" };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const valueOf = (s: V2LineScore, metric: string) => s.results.find((r) => r.metric === metric)?.value ?? null;

/** The criteria that most separate two lines, as "label: a vs b (points)". */
function why(a: V2LineScore, b: V2LineScore): string {
  return a.results
    .map((r) => ({ r, o: b.results.find((x) => x.criterionId === r.criterionId), d: r.contribution - (b.results.find((x) => x.criterionId === r.criterionId)?.contribution ?? 0) }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 3)
    .map(({ r, o, d }) => `${r.label}: ${fmt(r.value)} vs ${fmt(o?.value)} (${d >= 0 ? "+" : ""}${d.toFixed(1)})`)
    .join("; ");
}

function check(pack: BidPack, model: PilotModel, name: string): string[] {
  const ranked = rankLinesWithTrips(pack, model);
  const at = new Map(ranked.map((r, i) => [r.lineNumber, { r, rank: i + 1 }]));
  const get = (n: string) => {
    const x = at.get(n);
    if (!x) throw new Error(`Line ${n} isn't in ${pack.id}.`);
    return x;
  };
  const out = [`## ${name}`, "", "| His pick | | Site | Gap | Biggest differences (his line vs the other) |", "|---|---|---|---|---|"];
  let agree = 0;
  for (const [better, worse, how] of LINE_PICKS) {
    const b = get(better);
    const w = get(worse);
    const ok = b.r.score > w.r.score;
    if (ok) agree++;
    out.push(`| ${better} over ${worse} | ${how} | ${ok ? "agrees" : "**disagrees**"}: #${b.rank} (${b.r.score}) vs #${w.rank} (${w.r.score}) | ${(b.r.score - w.r.score).toFixed(1)} | ${why(b.r, w.r)} |`);
  }

  const trips = scoreTripsV2(pack, model, { onLineScale: false });
  const tp = trips.get(TRIP_PICK.preferred);
  const to = trips.get(TRIP_PICK.other);
  const tripOk = tp && to ? tp.score > to.score : null;
  out.push(
    "",
    `Line picks: **${agree} of ${LINE_PICKS.length}** the way he picked.`,
    `Trip pick (128 over 311, just): ${tripOk === null ? "trip not found" : `${tripOk ? "agrees" : "**disagrees**"} (${fmt(tp!.score)} vs ${fmt(to!.score)})`}.`,
    ""
  );

  // His rules, on the lines the site puts first.
  for (const n of [10, 20]) {
    const top = ranked.slice(0, n);
    const deps = top.map((s) => valueOf(s, "homeDepartures"));
    const longest = top.map((s) => valueOf(s, "longestTripDays"));
    const count = (xs: (number | null)[], f: (x: number) => boolean) => xs.filter((x): x is number => x !== null && f(x)).length;
    out.push(
      `Top ${n}: ${count(deps, (d) => d <= 2.05)} with 2 departures or fewer, ${count(deps, (d) => d > 2.05 && d <= 3.05)} with 3, ${count(deps, (d) => d > 3.05)} with 4 or more; ` +
        `${count(longest, (d) => d > 9)} with a trip over 9 days.`
    );
  }
  out.push("", `Site's top 10: ${ranked.slice(0, 10).map((s) => `${s.lineNumber} (${fmt(valueOf(s, "homeDepartures"))} dep, longest ${fmt(valueOf(s, "longestTripDays"))} d)`).join(", ")}`, "");
  return out;
}

(() => {
  const packPath = arg("pack") ?? DEFAULTS.pack;
  const profilePath = arg("profile") ?? DEFAULTS.profile;
  for (const p of [packPath, profilePath]) if (!existsSync(p)) throw new Error(`${p} isn't on this machine (it lives in the private folder).`);
  const pack = restoreBidPack(JSON.parse(readFileSync(packPath, "utf8")));
  const raw = JSON.parse(readFileSync(profilePath, "utf8"));
  const profile = migrateProfile(raw.profile ?? raw);
  const live = profile.pilotModel;
  const reviewed = profile.brainInterview?.reviewedModel;
  if (!live?.criteria?.length) throw new Error(`${profilePath} holds no pilot model.`);

  const lines = [`# Ex-pilot Nov 18 benchmark`, "", `${pack.id} · ${pack.lines.length} lines · ${profilePath}`, ""];
  lines.push(...check(pack, live, "Model the site ranks him with now"));
  if (reviewed?.criteria?.length) lines.push(...check(pack, applyCityRatings(reviewed, profile.cityRatings), "Model saved at the end of the interview"));
  const text = lines.join("\n");
  console.log(text);
  const out = arg("out");
  if (out) writeFileSync(out, text + "\n");
})();
