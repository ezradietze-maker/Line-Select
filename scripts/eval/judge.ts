/**
 * The yardstick: a strong model reads a pilot's own words and the raw trip
 * schedules of every line in a pack — not our metrics, not our scores — and
 * sorts the lines the way that pilot would bid them. Any ranking we build
 * (v1 scoring, v2, an interview's model) is measured against it.
 *
 * Lines are shown in a shuffled order so position can't sway the judge, and
 * a judgment is cached on disk: it's the expensive part, and the point is to
 * hold it fixed while the system under test changes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BidPack, Line, Trip } from "@/types/bidpack";

export const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-fable-5-1";

export interface Judgment {
  /** Line number -> A (top of their bid) … E (would never bid). */
  tiers: Record<string, "A" | "B" | "C" | "D" | "E">;
  /** His top lines, best first. */
  top: { line: string; why: string }[];
  /** What drove the judgment, in a few lines. */
  reasoning: string;
  costUsd: number;
}

const hhmm = (s: string) => `${s.slice(0, 2)}:${s.slice(2, 4)}`;

function dateOf(pack: BidPack, trip: Trip, dayOffset = 0): string {
  if (!pack.bidPeriodStart || trip.startDayIndex === null) return `day ${dayOffset + 1}`;
  const d = new Date(`${pack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + trip.startDayIndex + dayOffset);
  return d.toUTCString().slice(0, 11);
}

/** One line as a pilot would read it off the pack: totals, then each trip leg by leg, in local times. */
export function renderLine(pack: BidPack, line: Line): string {
  const out = [`LINE ${line.lineNumber} — ${line.daysOff} days off, ${line.totalCreditHours.toFixed(2)} credit, ${line.totalTafbHours.toFixed(1)}h TAFB, ${line.trips.length} trips${line.estimated ? " (trip details unverified)" : ""}`];
  for (const t of line.trips) {
    out.push(`  Trip #${t.pairingNumber ?? "?"} starts ${dateOf(pack, t)} · ${t.days} days · ${t.creditHours.toFixed(2)} credit · ${t.tafbHours.toFixed(1)}h TAFB`);
    if (t.schedule.length === 0) {
      out.push(`    (no leg detail) layovers: ${t.layoverCities.join(", ") || "none"}`);
      continue;
    }
    t.schedule.forEach((d, i) => {
      const legs = d.legs.map((l) =>
        l.isStandby
          ? `HOTEL STANDBY at ${l.depAirport} ${hhmm(l.depTimeLocal)}–${hhmm(l.arrTimeLocal)}`
          : `${l.flightNumber}${l.isDeadhead ? " (deadhead)" : ""} ${l.depAirport} ${hhmm(l.depTimeLocal)} → ${l.arrAirport} ${hhmm(l.arrTimeLocal)}${l.blockHours ? ` [${l.blockHours.toFixed(1)}h]` : ""}`
      );
      const lay = d.layover ? ` ⇒ layover ${d.layover.city} ${d.layover.hours.toFixed(1)}h${d.layover.hotelName ? ` (${d.layover.hotelName})` : ""}` : "";
      out.push(`    Duty ${i + 1} (report ${hhmm(d.reportTimeLocal)} local): ${legs.join("; ")}${lay}`);
    });
  }
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

const SYSTEM = `You are a veteran FedEx pilot and bid-line expert, bidding on behalf of one specific pilot. You will read that pilot's own words about how they bid, then every line in their bid pack, trip by trip. Judge each line exactly as THEY would — their priorities, in their order of importance, with the trade-offs they would actually make — not by general opinion of what a good line is. Read the schedules closely: deadheads (marked "(deadhead)"), where trips start and end relative to their home and base, legs per duty, layover cities and lengths, hotel standby, report times, and body-clock impact. Be decisive and consistent.`;

const SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "A few sentences: what decided the ranking for this pilot." },
    tiers: {
      type: "array",
      description: "Every line, exactly once, with its tier.",
      items: {
        type: "object",
        properties: { line: { type: "string" }, tier: { type: "string", enum: ["A", "B", "C", "D", "E"] } },
        required: ["line", "tier"],
        additionalProperties: false,
      },
    },
    top: {
      type: "array",
      description: "Their 12 best lines, best first, each with a one-line reason in their terms.",
      items: {
        type: "object",
        properties: { line: { type: "string" }, why: { type: "string" } },
        required: ["line", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "tiers", "top"],
  additionalProperties: false,
} as const;

export async function judgePack(opts: { pack: BidPack; pilotWords: string; pilotContext: string; cacheFile: string; seed?: number }): Promise<Judgment> {
  if (existsSync(opts.cacheFile)) return JSON.parse(readFileSync(opts.cacheFile, "utf8")) as Judgment;
  const lines = shuffled(opts.pack.lines, opts.seed ?? 7);
  const body = lines.map((l) => renderLine(opts.pack, l)).join("\n\n");
  const user = [
    `PILOT CONTEXT: ${opts.pilotContext}`,
    `BID PACK: ${opts.pack.month} ${opts.pack.base} ${opts.pack.aircraft} ${opts.pack.seat}, ${opts.pack.lines.length} lines. Times are local at each airport.`,
    `THE PILOT, IN THEIR OWN WORDS:\n"""\n${opts.pilotWords}\n"""`,
    `Sort every line into tiers: A = the top of their bid, B = good, C = acceptable, D = poor, E = they would never bid it. Use A and E sparingly (roughly the top and bottom 10–15% each). Then list their 12 best lines in order.`,
    `THE LINES:\n\n${body}`,
  ].join("\n\n");

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: JUDGE_MODEL,
    max_tokens: 64000,
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: user }],
  } as unknown as Anthropic.MessageCreateParamsStreaming);
  const res = await stream.finalMessage();
  if (res.stop_reason === "refusal") throw new Error("judge refused");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { reasoning: string; tiers: { line: string; tier: Judgment["tiers"][string] }[]; top: Judgment["top"] };
  const u = res.usage;
  const costUsd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * 10 + u.output_tokens * 50) / 1e6;
  const judgment: Judgment = { tiers: Object.fromEntries(parsed.tiers.map((t) => [t.line, t.tier])), top: parsed.top, reasoning: parsed.reasoning, costUsd };
  mkdirSync(opts.cacheFile.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(opts.cacheFile, JSON.stringify(judgment, null, 2));
  return judgment;
}
