import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fitTripWeights, type TripFitOptions } from "@/lib/brain/fit-choices";
import { structuredCall } from "@/lib/brain/llm";
import { pickTripScreen, shareForeseen, tripLabel, tripText, wantsAnotherScreen } from "@/lib/brain/trip-sort";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import { scoreTripsV2, tripKey, tripValueText } from "@/lib/scoring-v2/trip-score";
import type { Trip } from "@/types/bidpack";
import type { PilotModel, TripChoice } from "@/types/pilot-model";
import { PERSONAS, pilotWordsOf } from "./personas";
import { coherence, loadRun, PANEL, tripAgreement, tripJudges, type SimRun } from "./trip-scorecard";

/**
 * A bench for the interview's trip questions, without re-running whole interviews: each saved simulated interview's
 * model (fitted to its line choices) is put through a design of trip questions — which trips to show, how many, what
 * kind of question, how the answers are fitted — with the simulated pilot answering only those questions, and scored
 * against the trip judges. The judges' own trips are never shown, so a design can't learn their answers by heart.
 *
 * Answers are cached by question, so designs that ask the same thing share them and a re-run is free.
 *
 *   npx tsx scripts/eval/trip-lab.ts <design> [persona…]
 */

const SIM_MODEL = "claude-sonnet-5-5";
const SIM_SYSTEM = `You are role-playing a real FedEx pilot taking an interview about how they bid their lines. Everything you know about yourself is in the TRUTH SHEET: your own words from earlier conversations. Answer every question exactly as this pilot would — consistent with the truth sheet, in their voice (plain, conversational, a few sentences), never more polished than they are. If asked about something the truth sheet doesn't cover, answer the way someone with these priorities plausibly would, or say it doesn't matter much to you. Never mention the truth sheet.`;

type Pick = { pick: "a" | "b" | "tie"; strength: "slightly" | "strongly"; why: string };
type Grades = { grades: { trip: string; grade: "love" | "good" | "fine" | "poor" | "trade away" }[]; why: string };
const GRADE = { love: 5, good: 4, fine: 3, poor: 2, "trade away": 1 } as const;

export interface Design {
  name: string;
  /** "pair": which of two trips; "sort": grade a handful of trips at once. */
  kind: "pair" | "sort";
  /** Questions asked. */
  count: number;
  /** For "sort": trips per question. */
  size?: number;
  /**
   * How the trips are chosen: the most informative close calls. (The old pair picker the interview first shipped with
   * scored 0.739 / 0.740 here on two answer sets, Oct 21 2026; two screens of eight graded trips, 0.80.)
   */
  picker: "informative";
  fit?: TripFitOptions;
  /**
   * Ask more screens, up to this many, only while the answers keep surprising the model: after each screen past the
   * first two, another is asked if the model (as it stood) got fewer than `surprise` of that screen's comparisons right.
   */
  adaptive?: { max: number; surprise: number };
  /** Run the app's own trip-grade module end to end (`lib/brain/trip-sort.ts`): its picker, screens and fit. */
  app?: boolean;
}

export const DESIGNS: Record<string, Design> = {
  "informative-2": { name: "informative-2", kind: "pair", count: 2, picker: "informative" },
  "informative-4": { name: "informative-4", kind: "pair", count: 4, picker: "informative" },
  "sort5-1": { name: "sort5-1", kind: "sort", count: 1, size: 5, picker: "informative" },
  "sort5-2": { name: "sort5-2", kind: "sort", count: 2, size: 5, picker: "informative" },
  "sort5-3": { name: "sort5-3", kind: "sort", count: 3, size: 5, picker: "informative" },
  "sort6-2": { name: "sort6-2", kind: "sort", count: 2, size: 6, picker: "informative" },
  "sort6-3": { name: "sort6-3", kind: "sort", count: 3, size: 6, picker: "informative" },
  "sort8-1": { name: "sort8-1", kind: "sort", count: 1, size: 8, picker: "informative" },
  "sort8-2": { name: "sort8-2", kind: "sort", count: 2, size: 8, picker: "informative" },
  "sort8-3": { name: "sort8-3", kind: "sort", count: 3, size: 8, picker: "informative" },
  "sort8-adapt70": { name: "sort8-adapt70", kind: "sort", count: 2, size: 8, picker: "informative", adaptive: { max: 3, surprise: 0.7 } },
  "sort8-adapt80": { name: "sort8-adapt80", kind: "sort", count: 2, size: 8, picker: "informative", adaptive: { max: 3, surprise: 0.8 } },
  app: { name: "app", kind: "sort", count: 2, picker: "informative", app: true },
};
// The same designs with the fit loosened: answers are cached by question, so these re-use them.
for (const base of ["sort5-2", "sort5-3", "sort6-2", "sort6-3", "sort8-1", "sort8-2", "sort8-3", "sort8-adapt70", "sort8-adapt80", "informative-4"])
  for (const [tag, fit] of [["pb1", { pullBack: 1 }], ["pb05", { pullBack: 0.5 }], ["pb1-x5", { pullBack: 1, maxFactor: 5 }], ["pb05-x5", { pullBack: 0.5, maxFactor: 5 }]] as const)
    DESIGNS[`${base}-${tag}`] = { ...DESIGNS[base], name: `${base}-${tag}`, fit };

// ——— Answers, cached by question ———

const CACHE_DIR = ".cache/eval/trip-lab";
let spend = 0;
function cacheFile(persona: string) {
  return `${CACHE_DIR}/answers-${persona}.json`;
}
const caches = new Map<string, Record<string, unknown>>();
function cacheOf(persona: string): Record<string, unknown> {
  if (!caches.has(persona)) caches.set(persona, existsSync(cacheFile(persona)) ? JSON.parse(readFileSync(cacheFile(persona), "utf8")) : {});
  return caches.get(persona)!;
}
async function cachedSim<T>(persona: string, key: string, fresh: string, schema: Record<string, unknown>): Promise<T> {
  const cache = cacheOf(persona);
  // A second set of answers to the same questions, to tell a real difference between designs from one answer's luck.
  if (process.env.ANSWER_SEED) key = `${key}#${process.env.ANSWER_SEED}`;
  if (cache[key]) return cache[key] as T;
  const p = PERSONAS.find((x) => x.id === persona)!;
  const r = await structuredCall<T>({ model: SIM_MODEL, system: SIM_SYSTEM, user: { cached: `TRUTH SHEET:\n${pilotWordsOf(p)}`, fresh }, schema, effort: "low", maxTokens: 3000 });
  spend += r.usage.costUsd;
  cache[key] = r.data;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile(persona), JSON.stringify(cache, null, 1));
  return r.data;
}

// ——— Choosing trips ———

/** Trips the pilot's best lines fly, one date per pairing, none the judges graded and none already shown. */
function candidates(r: SimRun, model: PilotModel, exclude: Set<string>, shownPairings: Set<string>): Trip[] {
  const top = scorePackV2(r.pack, model, { pack: r.pm }).sort((a, b) => b.score - a.score).slice(0, 20);
  const byPairing = new Map<string, Trip>();
  for (const s of top)
    for (const t of r.pack.lines.find((l) => l.id === s.lineId)?.trips ?? [])
      if (t.schedule.length && !byPairing.has(t.id) && !shownPairings.has(t.id) && !exclude.has(tripKey(t))) byPairing.set(t.id, t);
  return [...byPairing.values()];
}

/**
 * The most informative close calls: two trips the model scores near each other that differ a lot on what the pilot
 * cares about — most of all on priorities earlier answers haven't touched yet.
 */
function informativeTrips(r: SimRun, model: PilotModel, pool: Trip[], n: number, touched: Map<string, number>): Trip[] {
  const scores = scoreTripsV2(r.pack, model, { pack: r.pm });
  const res = (t: Trip) => scores.get(tripKey(t));
  const trips = pool.filter((t) => res(t));
  const novelty = (id: string) => 1 / (1 + (touched.get(id) ?? 0));
  const value = (a: Trip, b: Trip) => {
    const A = res(a)!;
    const B = res(b)!;
    let info = 0;
    for (const ra of A.results) {
      const rb = B.results.find((x) => x.criterionId === ra.criterionId);
      if (!rb || ra.value === null || rb.value === null) continue;
      info += Math.abs(ra.utility - rb.utility) * ra.weight * novelty(ra.criterionId);
    }
    const gap = Math.abs(A.score - B.score);
    return info / (1 + (gap / 8) ** 2);
  };
  let best: [Trip, Trip] | null = null;
  let bestV = -1;
  for (let i = 0; i < trips.length; i++)
    for (let j = i + 1; j < trips.length; j++) {
      const v = value(trips[i], trips[j]);
      if (v > bestV) {
        bestV = v;
        best = [trips[i], trips[j]];
      }
    }
  if (!best) return [];
  const chosen = [...best];
  while (chosen.length < n) {
    const next = trips.filter((t) => !chosen.includes(t)).map((t) => ({ t, v: chosen.reduce((s, c) => s + value(t, c), 0) })).sort((a, b) => b.v - a.v)[0];
    if (!next) break;
    chosen.push(next.t);
  }
  return chosen;
}

/** Which priorities two or more trips differ on — what an answer about them teaches. */
function touch(r: SimRun, model: PilotModel, trips: Trip[], touched: Map<string, number>) {
  const scores = scoreTripsV2(r.pack, model, { pack: r.pm });
  const rs = trips.map((t) => scores.get(tripKey(t))!).filter(Boolean);
  for (const res of rs[0]?.results ?? []) {
    const us = rs.map((x) => x.results.find((y) => y.criterionId === res.criterionId)?.utility ?? 0);
    if (Math.max(...us) - Math.min(...us) > 0.2) touched.set(res.criterionId, (touched.get(res.criterionId) ?? 0) + 1);
  }
}

// ——— Asking ———

async function askPair(r: SimRun, model: PilotModel, a: Trip, b: Trip): Promise<TripChoice | null> {
  const scores = scoreTripsV2(r.pack, model, { pack: r.pm });
  const A = scores.get(tripKey(a))!;
  const B = scores.get(tripKey(b))!;
  const labelA = tripLabel(r.pack, a);
  const labelB = tripLabel(r.pack, b);
  // The differences the app would show: the biggest, both sides.
  const diffs = A.results
    .map((ra) => ({ ra, rb: B.results.find((x) => x.criterionId === ra.criterionId)! }))
    .filter((x) => x.rb && x.ra.value !== null && x.rb.value !== null && Math.abs(x.ra.utility - x.rb.utility) * x.ra.weight >= 0.06)
    .sort((x, y) => Math.abs(y.ra.utility - y.rb.utility) * y.ra.weight - Math.abs(x.ra.utility - x.rb.utility) * x.ra.weight)
    .slice(0, 5);
  const table = diffs.length ? `\n\nWhere they differ:\n${diffs.map((d) => `- ${d.ra.label}: ${labelA} ${tripValueText(d.ra) ?? "—"}, ${labelB} ${tripValueText(d.rb) ?? "—"}`).join("\n")}` : "";
  const pick = await cachedSim<Pick>(
    r.persona,
    `pair|${tripKey(a)}|${tripKey(b)}|${diffs.map((d) => d.ra.metric).join(",")}`,
    `Question: ${labelA} or ${labelB} — which trip would you rather fly? (Just these two trips — not the lines they're on — the way you'd size them up on a trade board.)${table}\n\nTrip A — ${labelA}:\n${tripText(r.pack, a)}\n\nTrip B — ${labelB}:\n${tripText(r.pack, b)}\n\nWhich would you rather fly? Say how strongly, and why in a sentence.`,
    { type: "object", additionalProperties: false, required: ["pick", "strength", "why"], properties: { pick: { type: "string", enum: ["a", "b", "tie"] }, strength: { type: "string", enum: ["slightly", "strongly"] }, why: { type: "string" } } }
  );
  if (pick.pick === "tie") return null;
  return { preferred: tripKey(pick.pick === "a" ? a : b), other: tripKey(pick.pick === "a" ? b : a), strength: pick.strength, why: pick.why };
}

/** A handful of trips graded at once; every two trips graded differently is a choice, "easily" when two grades apart. */
async function askSort(r: SimRun, trips: Trip[]): Promise<TripChoice[]> {
  const letters = trips.map((_, i) => String.fromCharCode(65 + i));
  const g = await cachedSim<Grades>(
    r.persona,
    `sort|${trips.map(tripKey).join("|")}`,
    `Question: here are ${trips.length} real trips from your pack. Grade each one the way you'd feel about flying it in your month — the way you'd size them up on a trade board: love, good, fine, poor, or trade away. Just these trips, not the lines they're on.\n\n${trips.map((t, i) => `Trip ${letters[i]} — ${tripLabel(r.pack, t)}:\n${tripText(r.pack, t)}`).join("\n\n")}\n\nGrade every trip (by its letter), and say in a sentence or two what decided it.`,
    {
      type: "object",
      additionalProperties: false,
      required: ["grades", "why"],
      properties: {
        grades: { type: "array", items: { type: "object", additionalProperties: false, required: ["trip", "grade"], properties: { trip: { type: "string", enum: letters }, grade: { type: "string", enum: ["love", "good", "fine", "poor", "trade away"] } } } },
        why: { type: "string" },
      },
    }
  );
  const graded = g.grades.flatMap((x) => {
    const t = trips[letters.indexOf(x.trip)];
    return t ? [{ key: tripKey(t), v: GRADE[x.grade] }] : [];
  });
  const out: TripChoice[] = [];
  for (const a of graded) for (const b of graded) if (a.v > b.v) out.push({ preferred: a.key, other: b.key, strength: a.v - b.v >= 2 ? "strongly" : "slightly", why: g.why });
  return out;
}

// ——— A design, on one saved interview ———

/** The app's trip grades, end to end: its screens, its rule for a third, its fit. */
async function runApp(r: SimRun, start: PilotModel, exclude: Set<string>) {
  const shown: string[][] = [];
  const choices: TripChoice[] = [];
  let model = start;
  let foreseen: number | null = null;
  const byKey = new Map(r.pack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t]));
  while (wantsAnotherScreen(shown.length, foreseen)) {
    const screen = pickTripScreen(r.pack, model, r.pm, shown, { exclude });
    if (!screen) break;
    shown.push(screen.keys);
    const got = await askSort(r, screen.keys.map((k) => byKey.get(k)!));
    foreseen = shareForeseen(r.pack, model, r.pm, got);
    choices.push(...got);
    model = { ...start, tripWeights: fitTripWeights(r.pack, start, choices, r.pm).tripWeights };
  }
  return { model, choices, screens: shown.length };
}

export async function runDesign(r: SimRun, d: Design) {
  const start: PilotModel = { ...r.model, tripWeights: undefined };
  const judges = tripJudges(r.persona);
  const exclude = new Set(judges.flatMap((j) => Object.values(j.labels)));
  const choices: TripChoice[] = [];
  const shown = new Set<string>();
  const touched = new Map<string, number>();
  if (d.app) {
    const a = await runApp(r, start, exclude);
    return { before: tripAgreement(r.pack, start, r.pm, judges), after: tripAgreement(r.pack, a.model, r.pm, judges), choices: a.choices.length, screens: a.screens * 8, coherence: coherence(r.pack, a.model, r.pm).rho, model: a.model };
  }
  let model = start;
  let surprised = true;
  for (let q = 0; q < (d.adaptive?.max ?? d.count); q++) {
    if (q >= d.count && !surprised) break;
    const trips = informativeTrips(r, model, candidates(r, model, exclude, shown), d.kind === "sort" ? (d.size ?? 5) : 2, touched);
    if (trips.length < 2) break;
    trips.forEach((t) => shown.add(t.id));
    touch(r, model, trips, touched);
    if (d.kind === "pair") {
      const c = await askPair(r, model, trips[0], trips[1]);
      if (c) choices.push(c);
    } else {
      const got = await askSort(r, trips);
      // Did the model, as it stood, already see this screen coming?
      const before = scoreTripsV2(r.pack, model, { pack: r.pm });
      const right = got.filter((c) => before.get(c.preferred)!.score > before.get(c.other)!.score).length;
      surprised = !!d.adaptive && got.length > 0 && right / got.length < d.adaptive.surprise;
      choices.push(...got);
    }
    const fit = fitTripWeights(r.pack, start, choices, r.pm, d.fit);
    model = { ...start, tripWeights: fit.tripWeights };
  }
  return {
    before: tripAgreement(r.pack, start, r.pm, judges),
    after: tripAgreement(r.pack, model, r.pm, judges),
    choices: choices.length,
    screens: shown.size,
    coherence: coherence(r.pack, model, r.pm).rho,
    model,
  };
}

if (process.argv[1]?.endsWith("trip-lab.ts")) {
  (async () => {
    process.loadEnvFile(".env.local");
    const d = DESIGNS[process.argv[2]];
    if (!d) throw new Error(`Designs: ${Object.keys(DESIGNS).join(", ")}`);
    const wanted = process.argv.slice(3);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const all: { before: number; after: number }[] = [];
    for (const [persona, tags] of Object.entries(PANEL)) {
      if (wanted.length && !wanted.includes(persona)) continue;
      const runs = tags.map((t) => loadRun(persona, t)).filter((r): r is SimRun => !!r);
      const res = await Promise.all(runs.map((r) => runDesign(r, d)));
      res.forEach((x, i) => console.log(`  ${persona} ${runs[i].tag}: trips ${x.before!.toFixed(3)} → ${x.after!.toFixed(3)} (${x.choices} choices) · lines vs trips ${x.coherence.toFixed(3)}`));
      console.log(`${persona}: trips ${mean(res.map((x) => x.before!)).toFixed(3)} → ${mean(res.map((x) => x.after!)).toFixed(3)}`);
      all.push(...res.map((x) => ({ before: x.before!, after: x.after! })));
    }
    console.log(`\n${d.name}: all runs ${mean(all.map((x) => x.before)).toFixed(3)} → ${mean(all.map((x) => x.after)).toFixed(3)} · spent $${spend.toFixed(2)}`);
  })();
}
