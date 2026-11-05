import type { PilotModel } from "@/types/pilot-model";
import { structuredCall, type BrainUsage, type Effort } from "./llm";

/**
 * Facts about the pilot that the brain's reading has no room for. The brain answers in a fixed format the API checks as
 * it writes, and that format is at its size limit — one more field and the call is refused. Packing its fields tighter
 * freed room but nudged how it read the pilot (Oct 2026: the ex-pilot's sort with his trip picks fell 96.9% → 96.5%
 * over 32 readings). So the brain's reading stays exactly as it is, and the facts are read by this second, small call
 * on the same interview, alongside it — with its own format, room for about 60 fields.
 *
 * Each fact is one line below: what to ask the transcript, and its kind. Its value goes where the app reads it
 * (`applyPilotFacts`); a pilot's own answer on a screen still wins over what this reads from their words.
 */

export interface InterviewTurn {
  turn: number;
  question: string;
  answer: string;
}

type FactKind = "hours" | "nights" | "yesNo";
interface FactDef {
  id: string;
  kind: FactKind;
  /** What it is, as the reader is asked it. */
  ask: string;
}

export const PILOT_FACTS = [
  {
    id: "minHomeHours",
    kind: "hours",
    ask: "For a commuter: the hours at home that make going home between two trips worth it, door to door (\"I only go home if I'll be there at least a day\"). Under that, they'd stay at base or in the hotel.",
  },
  { id: "hasCrashPad", kind: "yesNo", ask: "Keeps a crash pad, apartment or place of their own at base, so a night there costs them nothing extra." },
  {
    id: "minBreakNights",
    kind: "nights",
    ask: "How many days or nights at home in a row it takes before time at home between trips feels like a real break (\"I need at least three days home to feel like I've had a break\"). Days and nights count the same.",
  },
] as const satisfies readonly FactDef[];

export type PilotFactId = (typeof PILOT_FACTS)[number]["id"];

/**
 * A layover city they feel differently about in one season — "an Anchorage layover in the summer is great; in the
 * winter, less great" — as a change from their usual feeling, in grades (Love → Like is one).
 */
export interface CitySeasonFact {
  city: string;
  season: "winter" | "summer" | "months";
  /** For "months": the ones they named, 1 = January. */
  months: number[];
  change: number;
}

export interface PilotFacts {
  /** Only the facts the pilot gave; hours and nights as numbers, yes/no as booleans. */
  values: Partial<Record<PilotFactId, number | boolean>>;
  /** Cities whose grade moves with the season (`lib/seasons.ts` says which months are which, city by city). */
  citySeasons?: CitySeasonFact[];
  /** Their own words for each fact read, so it can be checked. */
  evidence: { fact: string; quote: string; turn: number }[];
}

const CITY_SEASONS_ASK =
  'Layover cities they feel differently about in one season ("Anchorage in the summer is great; in the winter, less great", "I avoid Phoenix in mid-summer", "Honolulu a little less in tourist season, June to August"). One entry per city and season. season: "winter" whenever they speak of winter or cold, "summer" whenever they speak of summer or heat — even when months are written beside it, since the winter and summer months of each city come from its weather; "months" only for months that are not about its weather (a tourist season, a holiday), listed in months (1 = January; empty otherwise). change: how their feeling moves then, in grades where one grade is love → like or like → neutral: -0.5 "slightly less", -1 "less great" or "might avoid it a bit", -2 "avoid it then", +1 "great in the summer" for a city they otherwise only like. City as its 3-letter airport code. Empty when they said nothing seasonal.';

const SYSTEM = `You read a FedEx pilot's bid interview and record specific facts they stated about themselves.

Record a fact only when the pilot said it or plainly implied it. Otherwise answer -1 for numbers and "unknown" for yes/no — never guess, and never fill in what pilots usually do. For each fact you record, quote their own words (dictation stutters cleaned up) and the turn they said it in.`;

function schema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of PILOT_FACTS as readonly FactDef[])
    properties[f.id] = f.kind === "yesNo" ? { type: "string", enum: ["yes", "no", "unknown"], description: f.ask } : { type: "number", description: `${f.ask} In ${f.kind}; -1 when not given.` };
  properties.citySeasons = {
    type: "array",
    description: CITY_SEASONS_ASK,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["city", "season", "months", "change"],
      properties: { city: { type: "string" }, season: { type: "string", enum: ["winter", "summer", "months"] }, months: { type: "array", items: { type: "integer" } }, change: { type: "number" } },
    },
  };
  properties.evidence = {
    type: "array",
    description: "One entry for each fact recorded above: its name, their own words, and the turn.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["fact", "quote", "turn"],
      properties: { fact: { type: "string", enum: [...PILOT_FACTS.map((f) => f.id), "citySeasons"] }, quote: { type: "string" }, turn: { type: "integer" } },
    },
  };
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

/** The reader's answer, checked: numbers inside a sane range, yes/no as booleans, unknowns left out. */
export function parsePilotFacts(raw: Record<string, unknown>): PilotFacts {
  const values: PilotFacts["values"] = {};
  for (const f of PILOT_FACTS as readonly FactDef[]) {
    const v = raw[f.id];
    if (f.kind === "yesNo") {
      if (v === "yes" || v === "no") values[f.id as PilotFactId] = v === "yes";
    } else if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= (f.kind === "hours" ? 240 : 31)) values[f.id as PilotFactId] = f.kind === "nights" ? Math.round(v) : v;
  }
  const citySeasons = Array.isArray(raw.citySeasons)
    ? (raw.citySeasons as unknown[]).flatMap((e): CitySeasonFact[] => {
        const x = e as { city?: unknown; season?: unknown; months?: unknown; change?: unknown };
        const city = typeof x.city === "string" ? x.city.trim().toUpperCase() : "";
        const season = x.season === "winter" || x.season === "summer" || x.season === "months" ? x.season : null;
        const months = Array.isArray(x.months) ? [...new Set(x.months.filter((m): m is number => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b) : [];
        const change = typeof x.change === "number" && Number.isFinite(x.change) ? Math.max(-4, Math.min(4, x.change)) : 0;
        if (!/^[A-Z]{3}$/.test(city) || !season || change === 0 || (season === "months" && months.length === 0)) return [];
        return [{ city, season, months: season === "months" ? months : [], change }];
      })
    : [];
  const ids = new Set<string>(Object.keys(values));
  if (citySeasons.length) ids.add("citySeasons");
  const evidence = Array.isArray(raw.evidence)
    ? (raw.evidence as unknown[]).flatMap((e) => {
        const x = e as { fact?: unknown; quote?: unknown; turn?: unknown };
        return typeof x.fact === "string" && ids.has(x.fact) && typeof x.quote === "string" && typeof x.turn === "number" ? [{ fact: x.fact, quote: x.quote, turn: x.turn }] : [];
      })
    : [];
  return { values, ...(citySeasons.length ? { citySeasons } : {}), evidence };
}

export async function readPilotFacts(input: { pilotContext: string; exchanges: InterviewTurn[]; apiKey?: string; model?: string; effort?: Effort }): Promise<{ facts: PilotFacts; usage: BrainUsage }> {
  const transcript = input.exchanges.map((e) => `[turn ${e.turn}]\nQ: ${e.question}\nA: ${e.answer}`).join("\n\n");
  const { data, usage } = await structuredCall<Record<string, unknown>>({
    apiKey: input.apiKey,
    model: input.model,
    system: SYSTEM,
    user: { fresh: `PILOT: ${input.pilotContext}\n\nTHE INTERVIEW:\n\n${transcript}\n\nRecord the facts now.` },
    schema: schema(),
    effort: input.effort ?? "low",
    maxTokens: 4000,
  });
  return { facts: parsePilotFacts(data), usage };
}

/**
 * The facts read, onto the model where the app reads them. Only a pilot with a known home has home facts; city seasons
 * are kept on `facts` and put on the city measures with the pilot's own city grades (`applyCityRatings`).
 */
export function applyPilotFacts(model: PilotModel, facts: PilotFacts): PilotModel {
  if (!model.home) return facts.citySeasons?.length ? { ...model, facts } : model;
  const home = { ...model.home };
  if (typeof facts.values.minHomeHours === "number") home.minHomeHours = facts.values.minHomeHours;
  if (typeof facts.values.hasCrashPad === "boolean") home.hasCrashPad = facts.values.hasCrashPad;
  if (typeof facts.values.minBreakNights === "number") home.minBreakNights = facts.values.minBreakNights;
  return { ...model, home, facts };
}
