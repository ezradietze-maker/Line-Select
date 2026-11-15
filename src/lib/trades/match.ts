import type { CarryInItem } from "@/lib/phase-in";
import { canHold, carryInReach, isTradeable, sortedTrips, touchesVacation, tripInstanceKey, tripSpan, vacationsOf, type LockedTrips } from "@/lib/trades/legality";
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
/**
 * How much each pass of the search for the best set may do, counted in options looked at: on the October packs at 40
 * pilots, the two passes take about half a second together.
 */
const MAX_SEARCH_WORK = 20_000_000;

export interface PilotHolding {
  pilotId: string;
  model: PilotModel;
  line: Line;
  seniority?: number | null;
  /** Trips this pilot can't trade (see `LockedTrips`). */
  locked?: LockedTrips;
  /**
   * What they carry in from last month (as Open time and View/Add read it): busy time any trip handed to them must fit
   * around; empty when they said nothing carries in. Undefined when they haven't said: then a trip starting while a
   * carry-in could still be flying (`carryInReach`) is handed them only when they already hold one starting as early,
   * as what they confirmed holding fits whatever they carry in.
   */
  carryIn?: readonly CarryInItem[];
  /**
   * Trades they agreed on the board that haven't gone through (`withBoardSwaps`): the trips they give in them (still on
   * `line`, locked) and those they take. Until then they may hold either, so a trip handed them must fit both ways.
   */
  agreed?: { gives: LockedTrips; takes: readonly Trip[] };
}

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
  const earliest = pilots.map((p) => Math.min(...p.line.trips.map((t) => tripSpan(pack, t)?.start ?? Infinity)));
  const reach = carryInReach(pack) ?? -Infinity;
  return (own: number, trip: number): boolean => {
    const key = own * nodes.length + trip;
    const seen = known.get(key);
    if (seen !== undefined) return seen;
    const pilot = nodes[own].pilot;
    const p = pilots[pilot];
    const taking = nodes[trip].trip;
    const starts = tripSpan(pack, taking)?.start ?? -Infinity;
    const others = p.line.trips.filter((t) => t !== nodes[own].trip);
    const agreed = p.agreed;
    const ok =
      (p.carryIn !== undefined || starts >= reach || earliest[pilot] <= starts) &&
      canHold(pack, others, taking, vacations[pilot], p.carryIn ?? []) &&
      (!agreed || canHold(pack, [...others.filter((t) => !agreed.gives.has(tripInstanceKey(t))), ...agreed.takes], taking, vacations[pilot], p.carryIn ?? []));
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
 * limit, when it keeps the best found.
 *
 * It starts from the better of two greedy sets (each trade worth the most still free, in turn; then each worth the most
 * per pilot), so a search cut short is never worse than those. Each step of the search takes one more trade and keeps
 * only the options that share no pilot with it, so it goes only as deep as the trades taken. And it gives up on a branch
 * as soon as what's left can't beat the best: a trade's worth shared among its pilots, each pilot still free can add at
 * most their best share among the options still open to them. Summing every option ahead instead, as it did, counted
 * one pilot once per trade they're on, and at 40 pilots the search never ended.
 */
export function bestSet(options: TradeSuggestion[]): { chosen: TradeSuggestion[]; complete: boolean } {
  const ids = new Map<string, number>();
  // A trade naming one pilot twice can't be done, whatever it's worth.
  const open = options.flatMap((o, i) => (o.worth > 0 && new Set(o.legs.map((l) => l.pilotId)).size === o.legs.length ? [i] : []));
  for (const i of open) for (const l of options[i].legs) if (!ids.has(l.pilotId)) ids.set(l.pilotId, ids.size);
  const legsOf = options.map((o) => o.legs.map((l) => ids.get(l.pilotId) ?? -1));
  const share = options.map((o) => o.worth / Math.max(1, o.legs.length));
  const marked = new Uint8Array(ids.size);
  // Worths are rounded to a tenth, so a sum within this of the best is the same.
  const EPS = 1e-6;

  const greedy = (order: number[]) => {
    marked.fill(0);
    const chosen: number[] = [];
    for (const i of order) {
      if (legsOf[i].some((p) => marked[p])) continue;
      for (const p of legsOf[i]) marked[p] = 1;
      chosen.push(i);
    }
    marked.fill(0);
    return chosen;
  };
  const worthOf = (set: number[]) => set.reduce((sum, i) => sum + options[i].worth, 0);
  const byWorth = [...open].sort((a, b) => options[b].worth - options[a].worth);
  const byShare = [...open].sort((a, b) => share[b] - share[a]);
  const seeds = [greedy(byWorth), greedy(byShare)];
  let best = worthOf(seeds[0]) >= worthOf(seeds[1]) ? seeds[0] : seeds[1];
  let bestWorth = worthOf(best);

  let work = 0;
  let complete = true;
  const taken: number[] = [];
  const walk = (candidates: number[], worth: number) => {
    // ahead[k]: the most the options from k on could add, each free pilot at their best share among them.
    const ahead = new Float64Array(candidates.length + 1);
    const bestShare = new Float64Array(ids.size);
    let sum = 0;
    for (let k = candidates.length - 1; k >= 0; k--) {
      const c = candidates[k];
      for (const p of legsOf[c]) {
        if (share[c] > bestShare[p]) {
          sum += share[c] - bestShare[p];
          bestShare[p] = share[c];
        }
      }
      ahead[k] = sum;
    }
    work += candidates.length;
    for (let k = 0; k < candidates.length; k++) {
      if (worth + ahead[k] <= bestWorth + EPS) return;
      if (work > MAX_SEARCH_WORK) {
        complete = false;
        return;
      }
      const c = candidates[k];
      const now = worth + options[c].worth;
      taken.push(c);
      if (now > bestWorth + EPS) {
        bestWorth = now;
        best = [...taken];
      }
      for (const p of legsOf[c]) marked[p] = 1;
      const rest: number[] = [];
      for (let j = k + 1; j < candidates.length; j++) if (!legsOf[candidates[j]].some((p) => marked[p])) rest.push(candidates[j]);
      for (const p of legsOf[c]) marked[p] = 0;
      work += candidates.length - k;
      if (rest.length) walk(rest, now);
      taken.pop();
      if (!complete) return;
    }
  };
  // Most worth per pilot first, then most worth: on the October packs each finds the better set on about half of them.
  // A search that ends is exact, so the second only runs when the first was cut short, starting from its best.
  for (const order of [byShare, byWorth]) {
    work = 0;
    complete = true;
    walk(order, 0);
    if (complete) break;
  }
  return { chosen: best.map((i) => options[i]), complete };
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
