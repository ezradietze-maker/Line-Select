import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripLabel } from "@/lib/brain/trip-sort";
import type { PackMetrics } from "@/lib/metrics/compute";
import { hubTurnsOf, summarizeHubTurns, type HubTurn } from "@/lib/metrics/hub-turns";
import { scorePackV2 } from "@/lib/scoring-v2/score";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Hub turning, asked by name with a real trip from the pilot's own pack — as the ex-pilot asked: the app should
 * recognize it, call it out, and ask each pilot how they feel about it, since some don't mind it and some strongly
 * object. Asked once, the same way for everyone whose pack has night hub turns, and a
 * second question about the crew-rest hotel when the pack has those long sits. The brain reads both answers.
 */

export const HUB_TURNS_LEAD = "Hub turns:";
export const REST_HOTEL_LEAD = "Crew-rest hotel:";

export interface HubTurnQuestion {
  prompt: string;
  helpText: string;
  options: string[];
  /** How it goes into the transcript: the question with the example it showed, so the brain reads the answer against it. */
  transcript: string;
}

const clock = (ms: number, airport: string) => DateTime.fromMillis(ms, { zone: timezoneForAirport(airport) ?? "UTC" }).toFormat("HH:mm");

/** Every trip once (one date each), with its own hub turns. */
function tripsWithTurns(bidPack: BidPack): { trip: Trip; turns: HubTurn[] }[] {
  const seen = new Set<string>();
  const out: { trip: Trip; turns: HubTurn[] }[] = [];
  for (const line of bidPack.lines)
    for (const trip of line.trips) {
      if (seen.has(trip.id)) continue;
      seen.add(trip.id);
      const turns = hubTurnsOf([trip], bidPack);
      if (turns.length) out.push({ trip, turns });
    }
  return out;
}

/**
 * The example to show: the strongest case of the kind asked about (a week of night hub turns beats a single one), and
 * among equals one from the pilot's best lines, so it's a trip they could really hold.
 */
function example(bidPack: BidPack, model: PilotModel | null, pack: PackMetrics, strength: (turns: HubTurn[]) => number): { trip: Trip; turns: HubTurn[] } | null {
  const all = tripsWithTurns(bidPack).filter((x) => strength(x.turns) > 0);
  if (!all.length) return null;
  const mine = new Set<string>();
  if (model) {
    const top = scorePackV2(bidPack, model, { pack }).sort((a, b) => b.score - a.score).slice(0, 20);
    for (const s of top) for (const t of bidPack.lines.find((l) => l.id === s.lineId)?.trips ?? []) mine.add(t.id);
  }
  return all.sort((a, b) => strength(b.turns) - strength(a.turns) || Number(mine.has(b.trip.id)) - Number(mine.has(a.trip.id)))[0];
}

/** A pack where hub turns are a real feature: some line has a week of night hub turns, or night hub turns are on at least this share of lines. */
const WORTH_ASKING_SHARE = 0.15;

/** "Trip #10 · Oct 4 flies DFW → IND, landing 00:59, sits through the sort until 03:35, then flies on to DFW — 4 nights in a row." */
function describe(bidPack: BidPack, x: { trip: Trip; turns: HubTurn[] }, kind: "night" | "rest"): string {
  const t = x.turns.find((h) => (kind === "rest" ? h.restHotel : h.night)) ?? x.turns[0];
  const runs = summarizeHubTurns(x.turns).longestRun;
  const sit = `${Math.floor(t.sitHours)}h${String(Math.round((t.sitHours % 1) * 60)).padStart(2, "0")}`;
  const base = `${tripLabel(bidPack, x.trip)} flies ${t.from} → ${t.hub}, landing ${clock(t.arrive, t.hub)}, sits ${sit} through the sort until ${clock(t.depart, t.hub)}, then flies on to ${t.to}`;
  if (kind === "rest") return `${base}, with a short stay at the ${t.restHotel} for a nap in between.`;
  return `${base}${runs > 1 ? ` — ${runs} nights in a row` : ""}.`;
}

function asked(exchanges: { question: string }[], lead: string): boolean {
  return exchanges.some((e) => e.question.startsWith(lead));
}

/** The next hub-turn question to ask, or null when the pack has none worth asking about or both have been asked. */
export function nextHubTurnQuestion(bidPack: BidPack, model: PilotModel | null, pack: PackMetrics, exchanges: { question: string }[]): HubTurnQuestion | null {
  if (!asked(exchanges, HUB_TURNS_LEAD)) {
    const perLine = bidPack.lines.map((l) => summarizeHubTurns(hubTurnsOf(l.trips, bidPack)));
    const linesWithWeeks = perLine.filter((s) => s.inWeeks > 0).length;
    if (!linesWithWeeks && perLine.filter((s) => s.night > 0).length < WORTH_ASKING_SHARE * bidPack.lines.length) return null;
    // A week of them first (the run of nights, then how many), else the most night hub turns on one trip; one without the
    // crew-rest hotel, so the nap (asked about next) doesn't colour the answer.
    const x = example(bidPack, model, pack, (turns) => {
      const s = summarizeHubTurns(turns);
      return (s.inWeeks ? 100 * s.longestRun + s.inWeeks : s.night) - (s.withRestHotel ? 0.5 : 0);
    });
    if (!x) return null;
    const prompt = "How do you feel about night hub turns like this one?";
    const example_ = describe(bidPack, x, "night");
    const helpText = `${example_} In this pack, ${linesWithWeeks} of ${bidPack.lines.length} lines have a week or more of night hub turns.`;
    const options = ["They don't bother me", "A night or two is fine — a week of them isn't", "I'd rather avoid them"];
    return { prompt, helpText, options, transcript: `${HUB_TURNS_LEAD} ${prompt} (Example: ${example_} ${linesWithWeeks} of ${bidPack.lines.length} lines here have a week or more of them.) Options: ${options.join(" / ")}` };
  }
  if (!asked(exchanges, REST_HOTEL_LEAD)) {
    const x = example(bidPack, model, pack, (turns) => turns.filter((h) => h.restHotel).length);
    if (!x) return null;
    const prompt = "Some long hub sits come with a crew-rest hotel, a short airport stay for a nap. Would you rather have that, or a shorter sit with no hotel?";
    const example_ = describe(bidPack, x, "rest");
    const options = ["I'd take the nap", "A shorter sit, no hotel", "No preference"];
    return { prompt, helpText: example_, options, transcript: `${REST_HOTEL_LEAD} ${prompt} (Example: ${example_}) Options: ${options.join(" / ")}` };
  }
  return null;
}
