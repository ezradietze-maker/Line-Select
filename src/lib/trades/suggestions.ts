import { createHash } from "node:crypto";
import { tripToSnapshot } from "@/lib/trade-client";
import { hasRealTimeTrading, tradeDeadlineHours, tripInstanceKey, tripSpan } from "@/lib/trades/legality";
import type { TradeSuggestion } from "@/lib/trades/match";
import type { BidPack, Trip } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TradeStepView, TradeSuggestionMember, TradeSuggestionRecord, TradeSuggestionView, TradeTrip } from "@/types/trade";

const HOUR = 3_600_000;

function tradeTrip(pack: BidPack, trip: Trip, lineNumber: string): TradeTrip {
  const snapshot = tripToSnapshot(trip, lineNumber, pack.bidPeriodStart);
  return { ...snapshot, id: trip.id, startDayIndex: trip.startDayIndex ?? 0, date: snapshot.date ?? null };
}

/** Names a trade whichever pilot it's listed from: the same pilots giving the same trips is the same trade. */
export function tradeSignature(packId: string, parts: readonly { pilotId: string; give: Pick<Trip, "id" | "startDayIndex"> }[]): string {
  const canonical = parts.map((p) => `${p.pilotId}:${tripInstanceKey(p.give)}`).sort().join("|");
  return createHash("sha256").update(`${packId}|${canonical}`).digest("hex");
}

/** When a trade stops being possible: the deadline of the earliest trip in it (CBA 2026 25.L.9.a.ii). */
export function tradeExpiry(pack: BidPack, trips: readonly Trip[]): Date {
  const shows = trips.map((t) => tripSpan(pack, t)?.start ?? Infinity);
  return new Date(Math.min(...shows) - tradeDeadlineHours(pack) * HOUR);
}

/** A found trade, ready to store. */
export function suggestionToStore(pack: BidPack, trade: TradeSuggestion, displayNames: ReadonlyMap<string, string>) {
  const meta: BidPackMetaSnapshot = { base: pack.base, aircraft: pack.aircraft, seat: pack.seat, month: pack.month };
  const gives = trade.legs.map((l) => l.value.give);
  return {
    signature: tradeSignature(pack.id, trade.legs.map((l) => ({ pilotId: l.pilotId, give: l.value.give }))),
    packId: pack.id,
    bidPackMeta: meta,
    steps: trade.plan.steps,
    expiresAt: tradeExpiry(pack, gives),
    members: trade.legs.map((l, position) => ({
      userId: l.pilotId,
      displayName: displayNames.get(l.pilotId) ?? "A pilot",
      position,
      give: tradeTrip(pack, l.value.give, "held"),
      value: {
        gain: l.value.gain,
        before: l.value.before,
        after: l.value.after,
        creditChange: l.value.creditChange,
        daysOffChange: l.value.daysOffChange,
        reasons: l.value.reasons,
      },
    })),
  };
}

/** Plays out the first `count` steps: which position's trip each position holds. Position `i` starts with their own and ends with `i + 1`'s. */
export function holdingsAfter(size: number, steps: readonly { a: number; b: number }[], count: number): number[] {
  const holds = Array.from({ length: size }, (_, i) => i);
  for (const { a, b } of steps.slice(0, count)) [holds[a], holds[b]] = [holds[b], holds[a]];
  return holds;
}

/** Whether every pilot it needs is still there: an account deleted leaves a gap no one can trade across. */
export function isWhole(s: Pick<TradeSuggestionRecord, "members" | "steps">): boolean {
  return s.members.length === s.steps.length + 1;
}

export function viewStatus(s: TradeSuggestionRecord, now: number): TradeSuggestionView["status"] {
  if (s.status === "done" || s.status === "cancelled") return s.status;
  if (!isWhole(s)) return "cancelled";
  // Once a trade has begun, it's for the pilots to finish: it stays open however late.
  return s.stepsDone === 0 && Date.parse(s.expiresAt) <= now ? "expired" : s.status;
}

/** A suggestion as `viewerId` may see it, or null if they aren't on it. No other pilot's id, score or reasons leave here. */
export function suggestionForViewer(s: TradeSuggestionRecord, viewerId: string, now = Date.now()): TradeSuggestionView | null {
  const me = s.members.find((m) => m.userId === viewerId);
  if (!me) return null;
  const size = s.steps.length + 1;
  const status = viewStatus(s, now);
  const at = new Map(s.members.map((m) => [m.position, m]));
  const trip = (position: number) => at.get(position)?.give ?? me.give;
  const name = (position: number) => at.get(position)?.displayName ?? "A pilot";
  const steps: TradeStepView[] = s.steps.map((step, i) => {
    const before = holdingsAfter(size, s.steps, i);
    const after = holdingsAfter(size, s.steps, i + 1);
    const yours = step.a === me.position || step.b === me.position;
    return {
      pilotA: name(step.a),
      pilotB: name(step.b),
      aGives: trip(before[step.a]),
      bGives: trip(before[step.b]),
      done: i < s.stepsDone,
      yours,
      youAreA: step.a === me.position,
      youAreB: step.b === me.position,
      canMarkDone: yours && status === "accepted" && i === s.stepsDone,
      youHoldAfter: yours ? trip(after[me.position]) : null,
    };
  });
  const orderedMembers: TradeSuggestionMember[] = [...s.members].sort((a, b) => a.position - b.position);
  return {
    id: s.id,
    status,
    cancelReason: s.cancelReason ?? (isWhole(s) ? null : "changed"),
    size,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
    you: { give: me.give, take: trip((me.position + 1) % size), value: me.value, answer: me.answer },
    pilots: orderedMembers.map((m) => ({ name: m.displayName, isYou: m.userId === viewerId, gives: m.give, accepted: m.answer === "accepted" })),
    steps,
    slowChainWarning: size > 2 && !hasRealTimeTrading(s.bidPackMeta),
  };
}
