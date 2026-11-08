import { and, desc, eq, inArray, isNull, or, gt } from "drizzle-orm";
import { db } from "@/lib/server/postgres";
import { preferenceProfiles, tradeHoldings, tradePreferences, tradeSuggestionMembers, tradeSuggestions, users } from "@/lib/server/schema";
import { tripInstanceKey } from "@/lib/trades/legality";
import type { MatchingRow } from "@/lib/trades/holding";
import { holdingsAfter, isWhole, type suggestionToStore } from "@/lib/trades/suggestions";
import type { BidPackMetaSnapshot, TradeAnswer, TradeHolding, TradeSuggestionMember, TradeSuggestionRecord } from "@/types/trade";

/** Suggested trades in the database (see `lib/trades/suggestions.ts` for what they mean). */

/** How long a finished or cancelled trade stays on a pilot's list. */
const RECENT_DAYS = 14;

type SuggestionRow = typeof tradeSuggestions.$inferSelect;
type MemberRow = typeof tradeSuggestionMembers.$inferSelect;

function toRecord(row: SuggestionRow, members: MemberRow[]): TradeSuggestionRecord {
  return {
    id: row.id,
    packId: row.packId,
    bidPackMeta: { base: row.base, aircraft: row.aircraft, seat: row.seat, month: row.month },
    status: row.status,
    cancelReason: row.cancelReason ?? null,
    steps: row.steps,
    stepsDone: row.stepsDone,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    members: members
      .map((m): TradeSuggestionMember => ({ userId: m.userId, displayName: m.displayName, position: m.position, give: m.give, value: m.value, answer: m.answer }))
      .sort((a, b) => a.position - b.position),
  };
}

const groupIs = (meta: BidPackMetaSnapshot) => and(eq(tradeHoldings.base, meta.base), eq(tradeHoldings.aircraft, meta.aircraft), eq(tradeHoldings.seat, meta.seat), eq(tradeHoldings.month, meta.month));
const suggestionGroupIs = (meta: BidPackMetaSnapshot) => and(eq(tradeSuggestions.base, meta.base), eq(tradeSuggestions.aircraft, meta.aircraft), eq(tradeSuggestions.seat, meta.seat), eq(tradeSuggestions.month, meta.month));

/** Everyone in a base, aircraft, seat and month who has confirmed what they hold, with what the matching needs. */
export async function listMatchingGroup(meta: BidPackMetaSnapshot): Promise<{ rows: MatchingRow[]; names: Map<string, string> }> {
  const holdings = await db.select().from(tradeHoldings).where(groupIs(meta));
  const ids = holdings.map((h) => h.userId);
  if (!ids.length) return { rows: [], names: new Map() };
  const [settings, profiles, people] = await Promise.all([
    db.select().from(tradePreferences).where(inArray(tradePreferences.userId, ids)),
    db.select().from(preferenceProfiles).where(inArray(preferenceProfiles.userId, ids)),
    db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)),
  ]);
  const settingsBy = new Map(settings.map((s) => [s.userId, s]));
  const profileBy = new Map(profiles.map((p) => [p.userId, p.profile]));
  const rows = holdings.map((h): MatchingRow => {
    const holding: TradeHolding = { packId: h.packId, bidPackMeta: meta, lineNumber: h.lineNumber, trips: h.trips, confirmedAt: h.confirmedAt.toISOString() };
    const s = settingsBy.get(h.userId);
    return { userId: h.userId, holding, settings: { suggestMe: s?.suggestMe ?? true, emailMatches: s?.emailMatches ?? false }, profile: profileBy.get(h.userId) ?? null };
  });
  return { rows, names: new Map(people.map((p) => [p.id, p.displayName])) };
}

/** What the matching must steer around in a group: pilots already on an open trade, trades already suggested, and swaps a pilot has said no to. */
export async function matchingHistory(meta: BidPackMetaSnapshot, now: Date) {
  const rows = await db.select().from(tradeSuggestions).where(suggestionGroupIs(meta));
  if (!rows.length) return { busyPilots: new Set<string>(), signatures: new Set<string>(), declined: new Set<string>() };
  const members = await db.select().from(tradeSuggestionMembers).where(inArray(tradeSuggestionMembers.suggestionId, rows.map((r) => r.id)));
  const bySuggestion = new Map<string, MemberRow[]>();
  for (const m of members) bySuggestion.set(m.suggestionId, [...(bySuggestion.get(m.suggestionId) ?? []), m]);
  const busyPilots = new Set<string>();
  const declined = new Set<string>();
  for (const r of rows) {
    const part = (bySuggestion.get(r.id) ?? []).sort((a, b) => a.position - b.position);
    const open = (r.status === "proposed" || r.status === "accepted") && (r.stepsDone > 0 || r.expiresAt > now);
    if (open) for (const m of part) busyPilots.add(m.userId);
    part.forEach((m, i) => {
      if (m.answer === "declined") declined.add(swapKey(m.userId, m.give, part[(i + 1) % part.length].give));
    });
  }
  return { busyPilots, signatures: new Set(rows.flatMap((r) => (r.signature ? [r.signature] : []))), declined };
}

export const swapKey = (userId: string, give: { id: string; startDayIndex: number | null }, take: { id: string; startDayIndex: number | null }) =>
  `${userId}|${tripInstanceKey(give)}|${tripInstanceKey(take)}`;

/** Stores a found trade. False if the same trade was stored first by another lookup. */
export async function saveSuggestion(s: ReturnType<typeof suggestionToStore>): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tradeSuggestions)
      .values({ signature: s.signature, packId: s.packId, ...s.bidPackMeta, steps: s.steps, expiresAt: s.expiresAt })
      .onConflictDoNothing({ target: tradeSuggestions.signature })
      .returning();
    if (!row) return false;
    await tx.insert(tradeSuggestionMembers).values(s.members.map((m) => ({ ...m, suggestionId: row.id })));
    return true;
  });
}

/** This pilot's open trades on this pack, and those that finished or lapsed lately. */
export async function listSuggestionsFor(userId: string, packId: string, now = new Date()): Promise<TradeSuggestionRecord[]> {
  const mine = await db.select({ id: tradeSuggestionMembers.suggestionId }).from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.userId, userId));
  if (!mine.length) return [];
  const recent = new Date(now.getTime() - RECENT_DAYS * 24 * 3_600_000);
  const rows = await db
    .select()
    .from(tradeSuggestions)
    .where(and(inArray(tradeSuggestions.id, mine.map((m) => m.id)), eq(tradeSuggestions.packId, packId), or(isNull(tradeSuggestions.resolvedAt), gt(tradeSuggestions.resolvedAt, recent))))
    .orderBy(desc(tradeSuggestions.createdAt));
  if (!rows.length) return [];
  const members = await db.select().from(tradeSuggestionMembers).where(inArray(tradeSuggestionMembers.suggestionId, rows.map((r) => r.id)));
  return rows.map((r) => toRecord(r, members.filter((m) => m.suggestionId === r.id)));
}

export type AnswerResult = { ok: true; record: TradeSuggestionRecord } | { ok: false; reason: "not-found" | "closed" };

/**
 * A pilot's answer. One no cancels the trade for everyone; the last yes opens it. In a transaction with the trade's row
 * locked, so two pilots answering together can't each miss the other's yes.
 */
export async function answerSuggestion(id: string, userId: string, answer: Exclude<TradeAnswer, "waiting">, now = new Date()): Promise<AnswerResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tradeSuggestions).where(eq(tradeSuggestions.id, id)).for("update");
    if (!row) return { ok: false, reason: "not-found" } as const;
    const members = await tx.select().from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.suggestionId, id));
    const me = members.find((m) => m.userId === userId);
    if (!me) return { ok: false, reason: "not-found" } as const;
    if (row.status !== "proposed" || row.expiresAt <= now || !isWhole({ members: toRecord(row, members).members, steps: row.steps })) return { ok: false, reason: "closed" } as const;
    await tx.update(tradeSuggestionMembers).set({ answer, answeredAt: now }).where(eq(tradeSuggestionMembers.id, me.id));
    const after = members.map((m) => (m.id === me.id ? { ...m, answer } : m));
    const next =
      answer === "declined"
        ? { status: "cancelled" as const, cancelReason: "declined" as const, resolvedAt: now }
        : after.every((m) => m.answer === "accepted")
          ? { status: "accepted" as const }
          : null;
    const [updated] = next ? await tx.update(tradeSuggestions).set(next).where(eq(tradeSuggestions.id, id)).returning() : [row];
    return { ok: true, record: toRecord(updated, after) } as const;
  });
}

export type StepResult = { ok: true; record: TradeSuggestionRecord } | { ok: false; reason: "not-found" | "not-yours" | "not-next" };

/**
 * A pilot says the next trade in the order went through. Either of the two can say so. What both pilots hold moves with
 * it, so a chain stopped partway still shows each of them what they really have.
 */
export async function markStepDone(id: string, userId: string, stepIndex: number, now = new Date()): Promise<StepResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tradeSuggestions).where(eq(tradeSuggestions.id, id)).for("update");
    if (!row) return { ok: false, reason: "not-found" } as const;
    const members = await tx.select().from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.suggestionId, id));
    const record = toRecord(row, members);
    const me = record.members.find((m) => m.userId === userId);
    if (!me) return { ok: false, reason: "not-found" } as const;
    if (row.status !== "accepted" || stepIndex !== row.stepsDone || !isWhole(record)) return { ok: false, reason: "not-next" } as const;
    const step = row.steps[stepIndex];
    if (step.a !== me.position && step.b !== me.position) return { ok: false, reason: "not-yours" } as const;

    const holds = holdingsAfter(row.steps.length + 1, row.steps, stepIndex);
    const pilot = (position: number) => record.members[position];
    const swap = async (position: number, other: number) => {
      const giving = pilot(holds[position]).give;
      const taking = pilot(holds[other]).give;
      const [held] = await tx.select().from(tradeHoldings).where(and(eq(tradeHoldings.userId, pilot(position).userId), eq(tradeHoldings.packId, row.packId))).for("update");
      if (!held) return;
      const trips = [...held.trips.filter((t) => tripInstanceKey(t) !== tripInstanceKey(giving)), { id: taking.id, startDayIndex: taking.startDayIndex, lock: null }].sort((x, y) => x.startDayIndex - y.startDayIndex);
      await tx.update(tradeHoldings).set({ trips, confirmedAt: now }).where(eq(tradeHoldings.id, held.id));
    };
    await swap(step.a, step.b);
    await swap(step.b, step.a);

    const stepsDone = stepIndex + 1;
    const finished = stepsDone === row.steps.length;
    const [updated] = await tx
      .update(tradeSuggestions)
      .set({ stepsDone, ...(finished ? { status: "done" as const, resolvedAt: now } : {}) })
      .where(eq(tradeSuggestions.id, id))
      .returning();
    return { ok: true, record: toRecord(updated, members) } as const;
  });
}

/**
 * A pilot's trips or wishes changed, so a trade not yet begun no longer stands. It may stand again later, so it's left
 * free to be found again (its signature goes). `onlyProposed` keeps a trade everyone has already agreed.
 */
export async function lapseSuggestionsFor(userId: string, packId: string | null, { onlyProposed = false } = {}, now = new Date()): Promise<void> {
  const mine = await db.select({ id: tradeSuggestionMembers.suggestionId }).from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.userId, userId));
  if (!mine.length) return;
  await db
    .update(tradeSuggestions)
    .set({ status: "cancelled", cancelReason: "changed", signature: null, resolvedAt: now })
    .where(
      and(
        inArray(tradeSuggestions.id, mine.map((m) => m.id)),
        packId ? eq(tradeSuggestions.packId, packId) : undefined,
        onlyProposed ? eq(tradeSuggestions.status, "proposed") : inArray(tradeSuggestions.status, ["proposed", "accepted"]),
        eq(tradeSuggestions.stepsDone, 0)
      )
    );
}
