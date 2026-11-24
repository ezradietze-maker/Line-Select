import { isPackId } from "@/lib/pack-id";
import type { RankedTrip } from "@/lib/trip-rankings";
import type { BidPack } from "@/types/bidpack";
import type { TripChoice } from "@/types/pilot-model";

/**
 * Moving trips on Trip Rankings. Each move — a trip put above the one above it, or below the one below — is a trip
 * choice like the interview's trip pairs (`TripChoice`), tagged with the move and the pack, and the pilot's priorities
 * on a trip refit to it (`fitTripWeights`, through `withModel`). The order the pilot sees keeps every move: their moves
 * are put back on top of the refitted ranking, oldest first, as they made them.
 */

/** A move: `above` was put over `below`. */
export function tripMoveChoice(above: string, below: string, moveId: string, packId: string): TripChoice {
  return { preferred: above, other: below, strength: "slightly", moveId, packId };
}

/**
 * A trip moved from one place in the list to another (`from` and `to` are positions in `order`, the trip keys as
 * shown): it was put above every trip it passed going up, or below every one it passed going down — one choice per
 * trip passed, as a drag on My Rankings is, all under one move so one undo takes it back.
 */
export function tripRelocationChoices(order: readonly string[], from: number, to: number, moveId: string, packId: string): TripChoice[] {
  const moved = order[from];
  // Where it was put says something too: the trip it now sits under stays above it (or over, below it). On the
  // simulated pilots that took trips nobody moved from 0.782 to 0.786 after six moves, with fewer of them losing any
  // on the first move (Nov 2026). A one-place move doesn't say it — the pilot may be on their way further.
  const passed = Math.abs(to - from);
  if (to < from) {
    const kept = passed > 1 && to > 0 ? [{ ...tripMoveChoice(order[to - 1], moved, moveId, packId), kept: true }] : [];
    return [...order.slice(to, from).map((k) => tripMoveChoice(moved, k, moveId, packId)), ...kept];
  }
  const kept = passed > 1 && to + 1 < order.length ? [{ ...tripMoveChoice(moved, order[to + 1], moveId, packId), kept: true }] : [];
  return [...order.slice(from + 1, to + 1).map((k) => tripMoveChoice(k, moved, moveId, packId)), ...kept];
}

/** The trip choices that are about this pack: the moves made on it, and the interview's (untagged) as before. */
export function tripChoicesHere(choices: readonly TripChoice[], bidPack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month">): TripChoice[] {
  return choices.filter((c) => !c.packId || isPackId(c.packId, bidPack));
}

/** The moves among them, oldest first. */
export function tripMovesHere(choices: readonly TripChoice[], bidPack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month">): TripChoice[] {
  return tripChoicesHere(choices, bidPack).filter((c) => c.moveId);
}

/**
 * The choices that still stand: a move is the pilot's latest word on two trips, so an earlier choice about the same
 * two — a move the other way, or the interview's pick — stops counting. Without a later move on them, every choice
 * counts as it always has.
 */
export function standingTripChoices(choices: readonly TripChoice[]): TripChoice[] {
  const pair = (c: TripChoice) => [c.preferred, c.other].sort().join("|");
  const lastMove = new Map<string, number>();
  choices.forEach((c, i) => c.moveId && lastMove.set(pair(c), i));
  return choices.filter((c, i) => (lastMove.get(pair(c)) ?? i) <= i);
}

/** The choices without the one a move added — undoing it. */
export function withoutTripMove(choices: readonly TripChoice[], moveId: string): TripChoice[] {
  return choices.filter((c) => c.moveId !== moveId);
}

/**
 * The ranked trips with the pilot's moves kept: each move, oldest first, puts its upper trip just above the lower one
 * if the ranking has it below. Replayed on the ranking they were made on, that is exactly the order the pilot left;
 * on a refitted one, the latest moves still hold. `placed` is every trip a move touched.
 */
export function placeTrips(ranked: readonly RankedTrip[], moves: readonly TripChoice[]): { trips: RankedTrip[]; placed: Set<string> } {
  const trips = [...ranked];
  const placed = new Set<string>();
  for (const m of moves) {
    const from = trips.findIndex((t) => t.key === m.preferred);
    const at = trips.findIndex((t) => t.key === m.other);
    if (from < 0 || at < 0) continue;
    if (m.kept) continue;
    placed.add(m.preferred).add(m.other);
    if (from < at) continue;
    const [moved] = trips.splice(from, 1);
    trips.splice(at, 0, moved);
  }
  return { trips, placed };
}

/**
 * What a refit did to the list, for telling the pilot: how many trips went up and down between two orders (trip keys,
 * best first), leaving out the trips they moved themselves, and the one that climbed furthest (places are 1-based).
 */
export function rankShifts(before: readonly string[], after: readonly string[], moved: ReadonlySet<string>): { up: number; down: number; climb: { key: string; from: number; to: number } | null } {
  const was = new Map(before.map((k, i) => [k, i]));
  let up = 0;
  let down = 0;
  let climb: { key: string; from: number; to: number } | null = null;
  after.forEach((k, i) => {
    const w = was.get(k);
    if (w === undefined || w === i || moved.has(k)) return;
    if (i < w) {
      up++;
      if (!climb || w - i > climb.from - climb.to) climb = { key: k, from: w + 1, to: i + 1 };
    } else down++;
  });
  return { up, down, climb };
}
