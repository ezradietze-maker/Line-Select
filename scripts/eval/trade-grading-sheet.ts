import { readFileSync, writeFileSync } from "node:fs";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { applyCityRatings } from "@/lib/brain/city-ratings";
import { prepareMetrics } from "@/lib/metrics/compute";
import { migrateProfile } from "@/lib/profile-migration";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import { findTrades, type PilotHolding, type TradeSuggestion } from "@/lib/trades/match";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";
import { latestPersona, PERSONAS, rng, varied } from "./trade-cohort";

/**
 * A sheet of trades the matcher suggests for the ex-pilot, on his own pack with his own priorities, for him to grade: the
 * real check on whether its idea of "better off" is his. The other pilots are simulated. His data stays in the gitignored
 * folder, and so does the sheet. Free: no AI calls.
 *
 *   npx tsx scripts/eval/trade-grading-sheet.ts [--line 1031] [--count 10]
 */
const DIR = "private/ex-pilot";
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const LINE = arg("line", "1031");
const COUNT = Number(arg("count", "10"));

const pack: BidPack = restoreBidPack(JSON.parse(readFileSync(`${DIR}/interview-export-2026-10-15/mem-md11-cap-oct26-pack.json`, "utf8")));
const profile = migrateProfile(JSON.parse(readFileSync(`${DIR}/benchmark-oct26/profile-oct21.json`, "utf8")));
const base = profile.brainInterview?.reviewedModel ?? profile.pilotModel;
if (!base) throw new Error("No pilot model in that profile.");
const model: PilotModel = applyCityRatings(base, profile.cityRatings);
const heldLine = pack.lines.find((l) => l.lineNumber === LINE);
if (!heldLine) throw new Error(`No line ${LINE} in this pack.`);

const prepared = prepareMetrics(pack);
const personas = PERSONAS.map(latestPersona);
const real = pack.lines.filter((l) => !l.estimated && l.id !== heldLine.id);
const now = Date.UTC(2026, 8, 20);
const ME = "you";

// Each run: a different seat around him, every other pilot on the best line left by their own priorities.
const found = new Map<string, TradeSuggestion>();
for (let seed = 1; seed <= 30; seed++) {
  const rand = rng(seed * 104_729);
  const taken = new Set<string>();
  const others: PilotHolding[] = [];
  const count = real.length;
  for (let i = 0; i < count; i++) {
    const m = varied(personas[Math.floor(rand() * personas.length)], pack.base, rand);
    const first = rankLinesWithTrips(pack, m, { pack: prepared }).find((s) => !taken.has(s.lineId) && s.lineId !== heldLine.id && real.some((l) => l.id === s.lineId));
    if (!first) continue;
    taken.add(first.lineId);
    others.push({ pilotId: `pilot-${seed}-${i}`, model: m, line: pack.lines.find((l) => l.id === first.lineId)! });
  }
  const { options } = findTrades(pack, [{ pilotId: ME, model, line: heldLine }, ...others], { now });
  for (const o of options) {
    const mine = o.legs.find((l) => l.pilotId === ME);
    if (mine) found.set(`${mine.value.give.id}@${mine.value.give.startDayIndex}>${mine.value.take.id}@${mine.value.take.startDayIndex}`, o);
  }
}

// Of what he'd give and get, a spread rather than ten versions of the best: the best few, then down through smaller gains.
const ranked = [...found.values()].sort((a, b) => gainOf(b) - gainOf(a));
function gainOf(t: TradeSuggestion) {
  return t.legs.find((l) => l.pilotId === ME)!.value.gain;
}
const chosen: TradeSuggestion[] = [];
const step = Math.max(1, Math.floor(ranked.length / COUNT));
for (let i = 0; i < ranked.length && chosen.length < COUNT; i += step) chosen.push(ranked[i]);

const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const date = (dayIndex: number | null) => {
  if (dayIndex === null || !pack.bidPeriodStart) return "";
  const d = new Date(`${pack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const describe = (t: Trip) => `Pairing ${t.pairingNumber ?? "?"}, ${date(t.startDayIndex)}: ${t.days}-day, ${t.layoverCities.join(" → ") || "no layovers"}, ${hhmm(t.creditHours)} credit, ${hhmm(t.tafbHours)} TAFB, ${t.deadheadLegs} deadhead legs`;
const figure = (x: number | null) => (x === null ? "none" : Number.isInteger(x) ? String(x) : x.toFixed(1));

const sheet = [
  "# Trip trades: would you do these?",
  "",
  `Imagine you hold **Line ${LINE}** on your October MEM MD-11 captain pack. Each trade below is one the site would suggest to you, using the priorities from your interview. The other pilots in it are made up, but their trips are real ones from the pack.`,
  "",
  "For each one, mark **I'd do it**, **Maybe** or **No**, and add a word on why. Where the site's reasons are wrong or miss what matters, that's the most useful thing you can tell us.",
  "",
  ...chosen.flatMap((t, i) => {
    const v = t.legs.find((l) => l.pilotId === ME)!.value;
    return [
      `## ${i + 1}. ${t.legs.length === 2 ? "A swap with one pilot" : `A chain of ${t.legs.length} pilots`}`,
      "",
      `- **You give:** ${describe(v.give)}`,
      `- **You get:** ${describe(v.take)}`,
      `- **Your score for the month:** ${v.before.toFixed(1)} → ${v.after.toFixed(1)} (+${v.gain.toFixed(1)})`,
      `- **Credit:** ${v.creditChange >= 0 ? "+" : "−"}${hhmm(Math.abs(v.creditChange))}. **Days off:** ${v.daysOffChange >= 0 ? "+" : "−"}${Math.abs(v.daysOffChange)}`,
      ...v.reasons.map((r) => `- **${r.better ? "Better" : "Costs you"}:** ${r.label} (${figure(r.from)} → ${figure(r.to)} ${r.unit})`),
      "",
      "Your grade: [ ] I'd do it  [ ] Maybe  [ ] No",
      "",
      "Why:",
      "",
    ];
  }),
].join("\n");

writeFileSync(`${DIR}/trip-trades-grading.md`, sheet);
const sizes = chosen.map((t) => t.legs.length);
console.log(`${found.size} different trades for line ${LINE}; ${chosen.length} on the sheet, sizes ${sizes.join(",")}, gains ${chosen.map((t) => gainOf(t).toFixed(1)).join(",")}`);
