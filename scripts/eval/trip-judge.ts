/**
 * The yardstick for trip scores: a strong model reads a pilot's own words and a sample of real trips from their pack —
 * raw schedules, not our metrics or scores — and grades each trip the way that pilot would feel about flying it. Then
 * every saved simulated interview's model scores the same trips (see `lib/scoring-v2/trip-score.ts`), and we compare.
 *
 *   npx tsx scripts/eval/trip-judge.ts <persona> [seed] [simTags…]
 *
 * Trips are labelled T1…Tn in a shuffled order so neither position nor a pairing number can sway the judge, and the
 * judgment is cached (`.cache/eval/trip-judge-<persona>-s<seed>.json`), like the line judge's.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expandBidPack } from "@/lib/bidpack-storage";
import { modelToDepartures } from "@/lib/brain/model-upgrade";
import { prepareMetrics } from "@/lib/metrics/compute";
import { scoreTripsV2, tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Trip } from "@/types/bidpack";
import { JUDGE_MODEL } from "./judge";
import { PERSONAS, pilotWordsOf } from "./personas";

const SAMPLE = 48;
const TIER = { A: 5, B: 4, C: 3, D: 2, E: 1 } as const;
type Tier = keyof typeof TIER;

const hhmm = (s: string) => `${s.slice(0, 2)}:${s.slice(2, 4)}`;
function dateOf(pack: BidPack, trip: Trip, offset = 0): string {
  if (!pack.bidPeriodStart || trip.startDayIndex === null) return `day ${offset + 1}`;
  const d = new Date(`${pack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + trip.startDayIndex + offset);
  return d.toUTCString().slice(0, 11);
}

function renderTrip(pack: BidPack, label: string, t: Trip): string {
  const out = [`${label} — starts ${dateOf(pack, t)}, ends ${dateOf(pack, t, t.days - 1)} · ${t.days} days · ${t.creditHours.toFixed(2)} credit · ${t.tafbHours.toFixed(1)}h away from base`];
  t.schedule.forEach((d, i) => {
    const legs = d.legs.map((l) =>
      l.isStandby
        ? `HOTEL STANDBY at ${l.depAirport} ${hhmm(l.depTimeLocal)}–${hhmm(l.arrTimeLocal)}`
        : `${l.flightNumber}${l.isDeadhead ? " (deadhead)" : ""} ${l.depAirport} ${hhmm(l.depTimeLocal)} → ${l.arrAirport} ${hhmm(l.arrTimeLocal)}${l.blockHours ? ` [${l.blockHours.toFixed(1)}h]` : ""}`
    );
    const lay = d.layover ? ` ⇒ layover ${d.layover.city} ${d.layover.hours.toFixed(1)}h` : "";
    out.push(`  Duty ${i + 1} (report ${hhmm(d.reportTimeLocal)} local): ${legs.join("; ")}${lay}`);
  });
  return out.join("\n");
}

function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SYSTEM = `You are a veteran FedEx pilot and bid-line expert, speaking for one specific pilot. You will read that pilot's own words about how they bid, then a set of real trips from their bid pack. Grade each trip exactly as THEY would feel about flying it in their month — the way they'd size it up on a trade board, deciding which trips to keep, drop or pick up — by their priorities, in their order, with the trade-offs they'd actually make. Read each schedule closely: its dates and length, deadheads (marked "(deadhead)"), where it starts and ends relative to their home and base, legs per duty, report times, night flying, layover cities and lengths, hotel standby, pay for the time away. Be decisive and consistent.`;

const SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "A few sentences: what made a trip good or bad for this pilot." },
    tiers: {
      type: "array",
      description: "Every trip, exactly once, with its grade.",
      items: { type: "object", properties: { trip: { type: "string" }, tier: { type: "string", enum: ["A", "B", "C", "D", "E"] } }, required: ["trip", "tier"], additionalProperties: false },
    },
  },
  required: ["reasoning", "tiers"],
  additionalProperties: false,
} as const;

/** Distinct trips with real schedules, sampled evenly through the pack (not by any score of ours). */
function sampleTrips(pack: BidPack, seed: number): Trip[] {
  const byKey = new Map<string, Trip>();
  for (const l of pack.lines) if (!l.estimated) for (const t of l.trips) if (t.schedule.length && !byKey.has(tripKey(t))) byKey.set(tripKey(t), t);
  // One instance per pairing first, so the sample covers the pack's variety rather than one pairing's many dates.
  const byPairing = new Map<string, Trip[]>();
  for (const t of byKey.values()) byPairing.set(t.id, [...(byPairing.get(t.id) ?? []), t]);
  const firsts = shuffled([...byPairing.values()].map((ts) => ts[seed % ts.length]), seed);
  const rest = shuffled([...byKey.values()].filter((t) => !firsts.includes(t)), seed + 1);
  return [...firsts, ...rest].slice(0, SAMPLE);
}

async function judgeTrips(persona: (typeof PERSONAS)[number], pack: BidPack, trips: Trip[], seed: number) {
  const file = `.cache/eval/trip-judge-${persona.id}-s${seed}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as { tiers: Record<string, Tier>; labels: Record<string, string>; reasoning: string; costUsd: number };
  const labels: Record<string, string> = {};
  const body = trips.map((t, i) => {
    labels[`T${i + 1}`] = tripKey(t);
    return renderTrip(pack, `T${i + 1}`, t);
  });
  const user = [
    `PILOT CONTEXT: ${persona.context}`,
    `BID PACK: ${pack.month} ${pack.base} ${pack.aircraft} ${pack.seat}. Times are local at each airport. You are seeing a sample of ${trips.length} of its trips; grade them against each other.`,
    `THE PILOT, IN THEIR OWN WORDS:\n"""\n${pilotWordsOf(persona)}\n"""`,
    `Grade every trip: A = a trip they'd love to have, B = good, C = fine, D = poor, E = one they'd do almost anything to get rid of. Use A and E sparingly (roughly the top and bottom 10–15% each).`,
    `THE TRIPS:\n\n${body.join("\n\n")}`,
  ].join("\n\n");
  const res = await new Anthropic().messages
    .stream({ model: JUDGE_MODEL, max_tokens: 32000, system: SYSTEM, output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } }, messages: [{ role: "user", content: user }] } as unknown as Anthropic.MessageCreateParamsStreaming)
    .finalMessage();
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { reasoning: string; tiers: { trip: string; tier: Tier }[] };
  const u = res.usage;
  const costUsd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * 10 + u.output_tokens * 50) / 1e6;
  const out = { tiers: Object.fromEntries(parsed.tiers.map((t) => [t.trip, t.tier])), labels, reasoning: parsed.reasoning, costUsd };
  writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const m = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = m(ra), mb = m(rb);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    n += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db);
}

async function main() {
  process.loadEnvFile(".env.local");
  const [pid, seedArg, ...tags] = process.argv.slice(2);
  const seed = Number(seedArg ?? 1);
  const persona = PERSONAS.find((p) => p.id === pid);
  if (!persona) throw new Error(`no persona ${pid}`);
  const pack = expandBidPack(JSON.parse(readFileSync(`.cache/packs/${persona.pack}.json`, "utf8")));
  const pm = prepareMetrics(pack);
  const trips = sampleTrips(pack, seed);
  const j = await judgeTrips(persona, pack, trips, seed);
  console.log(`judge (${j.costUsd.toFixed(2)} USD): ${j.reasoning.slice(0, 400)}`);
  for (const tag of tags) {
    const f = `.cache/eval/sim/${pid}-${tag}.json`;
    if (!existsSync(f)) continue;
    // As the app loads a saved model: a commuter's trip count and commutes move onto departures.
    const scores = scoreTripsV2(pack, modelToDepartures(JSON.parse(readFileSync(f, "utf8")).model), { pack: pm });
    const rows = Object.entries(j.labels).flatMap(([label, key]) => (scores.has(key) && j.tiers[label] ? [{ s: scores.get(key)!.score, t: TIER[j.tiers[label]] }] : []));
    console.log(`${tag}: trip spearman vs judge ${spearman(rows.map((r) => r.s), rows.map((r) => r.t)).toFixed(3)} (n=${rows.length})`);
  }
}

void main();
