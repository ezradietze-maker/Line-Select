import type { CarryInItem } from "@/lib/phase-in";
import { canHold, isTradeable, sortedTrips, touchesVacation, tripInstanceKey, vacationsOf, type LockedTrips } from "@/lib/trades/legality";
import { planChain, type TradePlan } from "@/lib/trades/plan";
import { valueSwaps, type SwapValue } from "@/lib/trades/value";
import type { BidPack, Line, Trip } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * Finds trades that leave every pilot in them better off: two pilots swapping, or a chain where each hands a trip to the
 * next and the last hands one to the first. Each pilot judges by their own priorities (`value.ts`), so a trade can suit
 * everyone: what one pilot is glad to lose is what another wants.
 *
 * The same problem as a kidney-exchange: pilots' trips are the nodes, an arrow runs from a trip to one its holder would
 * rather have, and a trade is a cycle. Cycles are short and bounded, so they can be listed outright, then the best set
 * that uses each pilot once is chosen. "Each pilot" is by `pilotId`, never by place in the list: one pilot listed twice
 * must still never be handed two trips in one chain.
 */

export const MAX_CHAIN_PILOTS = 5;
/** A pilot's month must improve by at least this, on the 0-100 score, to count as better off. Below it, the score's own margin is the likelier explanation. */
export const MIN_GAIN = 1;
/** What each trade in a chain costs in effort and risk, in score points, so a longer chain has to earn its extra steps. */
const EFFORT_PER_TRADE = 0.5;
/** Each trip's best alternatives kept: past these, it's only ever a worse way to help the same pilot. */
const MAX_OPTIONS_PER_TRIP = 12;
const MAX_CYCLES = 200_000;
const MAX_SEARCH_NODES = 500_000;

export interface PilotHolding {
  pilotId: string;
  model: PilotModel;
  line: Line;
  seniority?: number | null;
  /** Trips this pilot can't trade (see `LockedTrips`). */
  locked?: LockedTrips;
  /**
   * What they carry in from last month (as Open time and View/Add read it): busy time any trip handed to them must fit
   * around. Undefined when they haven't said, as for a holding confirmed before it was asked: then a trip in the month's
   * first days is handed them only when they already hold one that early (`CARRY_IN_DAYS`).
   */
  carryIn?: readonly CarryInItem[];
}

/**
 * The days a trip carried in from last month can still be flying. A pilot whose carry-in isn't known takes a trip
 * starting in them only when they already hold one starting as early: what they confirmed holding fits their carry-in.
 */
const CARRY_IN_DAYS = 2;

export interface TradeLeg {
  pilotId: string;
  value: SwapValue;
}

export interface TradeSuggestion {
  /** In chain order: each pilot gives their `value.give` to the pilot before them, and takes their `value.take` from the one after. */
  legs: TradeLeg[];
  plan: TradePlan;
  /** Everyone's gains less the effort of the trades: how the best set is chosen. */
  worth: number;
}

export interface MatchResult {
  /** The best set of trades, each pilot in at most one. */
  trades: TradeSuggestion[];
  /** Every legal trade found, best first: the alternatives a pilot could be offered. */
  options: TradeSuggestion[];
  /** The search hit its limit before listing everything, so a better trade may exist. */
  truncated: boolean;
}

export interface MatchOptions {
  now?: number;
  maxChain?: number;
  minGain?: number;
  /** How many chains to list before sharing out what's left (see `listCycles`). */
  maxCycles?: number;
  /** A swap not to suggest again: this pilot has said no to it. */
  excludeSwap?: (pilotId: string, give: Trip, take: Trip) => boolean;
  /** A pilot who has said a trade wasn't worth it needs more than the usual gain. */
  minGainFor?: (pilotId: string) => number | undefined;
  /** When to stop looking (epoch ms, by the clock): what was found by then is kept, and the result says it's partial. */
  deadline?: number;
}

interface Node {
  pilot: number;
  trip: Trip;
}

interface Edge {
  to: number;
  value: SwapValue;
}

/**
 * Whether the pilot giving up node `own`'s trip could hold node `trip`'s in its place, asked of every arrow and then again
 * of every step of every chain's order: each answered once, as the full check (`canHold`) reads the whole month.
 */
function holdChecker(pack: BidPack, pilots: readonly PilotHolding[], nodes: Node[]) {
  const known = new Map<number, boolean>();
  const vacations = pilots.map((p) => vacationsOf(pack, p.seniority));
  const earliest = pilots.map((p) => Math.min(...p.line.trips.map((t) => t.startDayIndex ?? Infinity)));
  return (own: number, trip: number): boolean => {
    const key = own * nodes.length + trip;
    const seen = known.get(key);
    if (seen !== undefined) return seen;
    const pilot = nodes[own].pilot;
    const p = pilots[pilot];
    const taking = nodes[trip].trip;
    const day = taking.startDayIndex ?? 0;
    const ok =
      (p.carryIn !== undefined || day >= CARRY_IN_DAYS || earliest[pilot] <= day) &&
      canHold(pack, p.line.trips.filter((t) => t !== nodes[own].trip), taking, vacations[pilot], p.carryIn ?? []);
    known.set(key, ok);
    return ok;
  };
}

function buildGraph(
  pack: BidPack,
  pilots: readonly PilotHolding[],
  now: number,
  minGain: number,
  excludeSwap: MatchOptions["excludeSwap"],
  minGainFor: MatchOptions["minGainFor"],
  deadline = Infinity
) {
  let late = false;
  const nodes: Node[] = [];
  pilots.forEach((p, pilot) => {
    const vacations = vacationsOf(pack, p.seniority);
    for (const trip of sortedTrips(p.line)) if (isTradeable(pack, trip, p.locked ?? new Set(), now) && !touchesVacation(pack, trip, vacations)) nodes.push({ pilot, trip });
  });
  const fits = holdChecker(pack, pilots, nodes);
  const edges: Edge[][] = nodes.map(() => []);
  pilots.forEach((p, pilot) => {
    // Out of time: the pilots not reached yet want nothing this run, and the result says it's partial.
    if (late || (late = Date.now() > deadline)) return;
    const mine = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.pilot === pilot);
    const swaps: { give: Trip; take: Trip }[] = [];
    const swapIndex = new Map<string, number>();
    const wanted: { from: number; to: number; swap: number }[] = [];
    for (const { n: giving, i: from } of mine) {
      for (let to = 0; to < nodes.length; to++) {
        const taking = nodes[to];
        if (pilots[taking.pilot].pilotId === p.pilotId || tripInstanceKey(taking.trip) === tripInstanceKey(giving.trip)) continue;
        if (!fits(from, to)) continue;
        if (excludeSwap?.(p.pilotId, giving.trip, taking.trip)) continue;
        // The same trip on the same date from two different pilots is one swap to score.
        const key = `${from}|${tripInstanceKey(taking.trip)}`;
        let swap = swapIndex.get(key);
        if (swap === undefined) {
          swap = swaps.length;
          swaps.push({ give: giving.trip, take: taking.trip });
          swapIndex.set(key, swap);
        }
        wanted.push({ from, to, swap });
      }
    }
    const values = valueSwaps(pack, p.line, p.model, swaps);
    const needed = Math.max(minGain, minGainFor?.(p.pilotId) ?? 0);
    for (const w of wanted) if (values[w.swap].gain >= needed) edges[w.from].push({ to: w.to, value: values[w.swap] });
  });
  for (const list of edges) {
    list.sort((a, b) => b.value.gain - a.value.gain);
    list.length = Math.min(list.length, MAX_OPTIONS_PER_TRIP);
  }
  return { nodes, edges, late, fits };
}

/**
 * Every cycle up to `maxChain` long through different pilots (by `pilotId`), each listed once, starting from its lowest-numbered trip.
 * When there are too many to list, each trip gets its share at each length, best arrows first: a limit reached in one
 * crowded corner of the graph must not hide the swap two other pilots could make, and a pile of long chains must not hide
 * a short one.
 */
function listCycles(pilots: readonly PilotHolding[], nodes: Node[], edges: Edge[][], maxChain: number, maxCycles: number, deadline = Infinity): { cycles: Edge[][]; truncated: boolean } {
  const idOf = (node: number) => pilots[nodes[node].pilot].pilotId;
  const cycles: Edge[][] = [];
  let truncated = false;
  const share = Math.max(1, Math.floor(maxCycles / Math.max(1, nodes.length * (maxChain - 1))));
  for (let length = 2; length <= maxChain; length++) {
    for (let start = 0; start < nodes.length; start++) {
      if (Date.now() > deadline) return { cycles, truncated: true };
      const onIt = new Set([idOf(start)]);
      const path: Edge[] = [];
      let found = 0;
      const walk = (at: number) => {
        for (const e of edges[at]) {
          if (found >= share) {
            truncated = true;
            return;
          }
          if (path.length + 1 === length) {
            if (e.to === start) {
              cycles.push([...path, e]);
              found++;
            }
            continue;
          }
          if (e.to <= start || onIt.has(idOf(e.to))) continue;
          onIt.add(idOf(e.to));
          path.push(e);
          walk(e.to);
          path.pop();
          onIt.delete(idOf(e.to));
        }
      };
      walk(start);
    }
  }
  return { cycles, truncated };
}

/** The cycle as a suggestion with its order of trades, or null when no order is legal throughout. */
function toSuggestion(pilots: readonly PilotHolding[], nodes: Node[], cycle: Edge[], start: number, fits: (own: number, trip: number) => boolean): TradeSuggestion | null {
  const chain = [start, ...cycle.slice(0, -1).map((e) => e.to)];
  // Each moment of each order is checked as the arrows were: the same rules, the same carry-in, each answered once.
  const plan = planChain(chain.length, (pilotAt, tripAt) => fits(chain[pilotAt], chain[tripAt]));
  if (!plan) return null;
  const legs = cycle.map((e, i) => ({ pilotId: pilots[nodes[chain[i]].pilot].pilotId, value: e.value }));
  const worth = legs.reduce((sum, l) => sum + l.value.gain, 0) - EFFORT_PER_TRADE * plan.steps.length;
  return { legs, plan, worth: Math.round(worth * 10) / 10 };
}

/**
 * The set of trades worth the most in all, each pilot (by `pilotId`) in at most one. Exact unless the search hits its
 * limit, when it keeps the best found. Each level of the search picks the next trade to take, so it goes only as deep as
 * the trades taken, however many options there are: one level per option overflowed the stack at a few thousand.
 */
export function bestSet(options: TradeSuggestion[]): { chosen: TradeSuggestion[]; complete: boolean } {
  const worthFromHere = new Array<number>(options.length + 1).fill(0);
  for (let i = options.length - 1; i >= 0; i--) worthFromHere[i] = worthFromHere[i + 1] + Math.max(0, options[i].worth);
  // A trade naming one pilot twice can't be done, whatever it's worth.
  const usable = options.map((o) => o.worth > 0 && new Set(o.legs.map((l) => l.pilotId)).size === o.legs.length);
  let best: TradeSuggestion[] = [];
  let bestWorth = 0;
  let visited = 0;
  let complete = true;
  const used = new Set<string>();
  const taken: TradeSuggestion[] = [];
  const walk = (from: number, worth: number) => {
    if (worth > bestWorth) {
      bestWorth = worth;
      best = [...taken];
    }
    for (let i = from; i < options.length; i++) {
      // Nothing further on can lift this past the best: what's left only shrinks.
      if (worth + worthFromHere[i] <= bestWorth) return;
      if (++visited > MAX_SEARCH_NODES) {
        complete = false;
        return;
      }
      const o = options[i];
      if (!usable[i] || o.legs.some((l) => used.has(l.pilotId))) continue;
      for (const l of o.legs) used.add(l.pilotId);
      taken.push(o);
      walk(i + 1, worth + o.worth);
      taken.pop();
      for (const l of o.legs) used.delete(l.pilotId);
      if (!complete) return;
    }
  };
  walk(0, 0);
  return { chosen: best, complete };
}

export function findTrades(pack: BidPack, pilots: readonly PilotHolding[], options: MatchOptions = {}): MatchResult {
  const maxChain = Math.min(options.maxChain ?? MAX_CHAIN_PILOTS, MAX_CHAIN_PILOTS);
  const deadline = options.deadline ?? Infinity;
  const { nodes, edges, late, fits } = buildGraph(pack, pilots, options.now ?? Date.now(), options.minGain ?? MIN_GAIN, options.excludeSwap, options.minGainFor, deadline);
  const listed = listCycles(pilots, nodes, edges, maxChain, options.maxCycles ?? MAX_CYCLES, deadline);
  let truncated = late || listed.truncated;
  const startOf = (cycle: Edge[]) => cycle[cycle.length - 1].to;
  const suggestions: TradeSuggestion[] = [];
  for (const c of listed.cycles) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const s = toSuggestion(pilots, nodes, c, startOf(c), fits);
    if (s) suggestions.push(s);
  }
  suggestions.sort((a, b) => b.worth - a.worth);
  const { chosen, complete } = bestSet(suggestions);
  return { trades: chosen, options: suggestions, truncated: truncated || !complete };
}
