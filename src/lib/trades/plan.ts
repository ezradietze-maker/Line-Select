/**
 * The order to do a trade in. CBA 2026 25.L.9.a.i has a pilot trade "with another pilot", two at a time, so a chain of
 * five takes four trades, and between them a pilot can hold a trip they don't want. Each of those moments has to be legal
 * for whoever is holding it (25.L.1.d), so the order matters, and some chains have no order that works.
 *
 * A chain of n can be done in n − 1 trades in n^(n−2) orders (125 at five pilots), few enough to try them all.
 */

export interface TradeStep {
  /** Positions in the chain: each step is a trade between these two pilots. */
  a: number;
  b: number;
}

export interface TradePlan {
  steps: TradeStep[];
  /** Across the steps, how many times a pilot is left holding a trip that isn't their final one: what's at stake if someone stops. */
  exposure: number;
}

/** How many cycles the holdings still have to resolve: a trade that's part of the shortest route splits one. */
function remaining(holds: number[], wants: number[]): number {
  const seen = new Set<number>();
  let cycles = 0;
  for (let i = 0; i < holds.length; i++) {
    if (seen.has(i)) continue;
    cycles++;
    let at = i;
    while (!seen.has(at)) {
      seen.add(at);
      at = wants.indexOf(holds[at]);
    }
  }
  return holds.length - cycles;
}

/**
 * The order with the least left at stake, or null when no order is legal throughout. Position `i` gives up trip `i` and
 * ends with trip `i + 1` (the last wraps round to 0). `canHold(pilot, trip)` says whether that pilot could hold that trip
 * alongside the rest of their schedule.
 */
export function planChain(size: number, canHold: (pilot: number, trip: number) => boolean): TradePlan | null {
  const wants = Array.from({ length: size }, (_, i) => (i + 1) % size);
  let best: TradePlan | null = null;
  const walk = (holds: number[], steps: TradeStep[], exposure: number) => {
    const left = remaining(holds, wants);
    if (left === 0) {
      if (!best || exposure < best.exposure) best = { steps, exposure };
      return;
    }
    for (let a = 0; a < size; a++) {
      for (let b = a + 1; b < size; b++) {
        const next = [...holds];
        next[a] = holds[b];
        next[b] = holds[a];
        if (remaining(next, wants) !== left - 1) continue;
        if (!canHold(a, next[a]) || !canHold(b, next[b])) continue;
        const stuck = next.filter((t, p) => t !== wants[p] && t !== p).length;
        walk(next, [...steps, { a, b }], exposure + stuck);
      }
    }
  };
  walk(Array.from({ length: size }, (_, i) => i), [], 0);
  return best;
}
