import { and, countDistinct, desc, eq, gte, inArray, isNull, lt, or, gt } from "drizzle-orm";
import { legacyPackIdFor, packIdFor } from "@/lib/pack-id";
import { agreedTrades, freeOffersOfMovedTrips, lockPilotsInSeat } from "@/lib/server/db";
import { db } from "@/lib/server/postgres";
import { verifiedUserIds } from "@/lib/server/verified-pilots";
import { bidPackMetaOf, preferenceProfiles, tradeHoldings, tradeOffers, tradePreferences, tradeSuggestionMembers, tradeSuggestions, users } from "@/lib/server/schema";
import { tripInstanceKey } from "@/lib/trades/legality";
import type { MatchingRow } from "@/lib/trades/holding";
import { agreedBoardSwaps, agreedBoardTrips, alreadyTraded, type GivenTrip } from "@/lib/trades/offer-trips";
import { holdingsAfter, isWhole, type suggestionToStore } from "@/lib/trades/suggestions";
import type { Seat } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TradeAnswer, TradeDeclineReason, TradeHolding, TradeOffer, TradeSuggestionMember, TradeSuggestionRecord, TradeTrip } from "@/types/trade";

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

/** The ids a pack in this group may be stored under: its own, and the one it had before ids named the aircraft. */
const packIdsOf = (packId: string, meta: BidPackMetaSnapshot) => (packId === packIdFor({ ...meta, seat: meta.seat as Seat }) ? [packId, legacyPackIdFor({ ...meta, seat: meta.seat as Seat })] : [packId]);

/**
 * Everyone in a base, aircraft, seat and month who has confirmed what they hold, with what the matching needs: one row
 * each. A pilot who confirmed under the pack's older id and again under its own has two holdings; the one under its own
 * id is what they hold now, and keyed by pilot, two would overwrite each other's pack fingerprint. Confirmed accounts
 * only: unconfirmed ones aren't matched, and a few made-up ones mustn't outvote the seat on which pack it's matched on.
 */
export async function listMatchingGroup(meta: BidPackMetaSnapshot): Promise<{ rows: MatchingRow[]; names: Map<string, string>; fingerprints: Map<string, string | null> }> {
  const current = packIdFor({ ...meta, seat: meta.seat as Seat });
  const byUser = new Map<string, typeof tradeHoldings.$inferSelect>();
  for (const h of await db.select().from(tradeHoldings).where(and(groupIs(meta), inArray(tradeHoldings.userId, verifiedUserIds())))) {
    const kept = byUser.get(h.userId);
    const better = !kept || (kept.packId !== current && (h.packId === current || h.confirmedAt > kept.confirmedAt));
    if (better) byUser.set(h.userId, h);
  }
  const holdings = [...byUser.values()];
  const ids = holdings.map((h) => h.userId);
  if (!ids.length) return { rows: [], names: new Map(), fingerprints: new Map() };
  const [settings, profiles, people] = await Promise.all([
    db.select().from(tradePreferences).where(inArray(tradePreferences.userId, ids)),
    db.select().from(preferenceProfiles).where(inArray(preferenceProfiles.userId, ids)),
    db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)),
  ]);
  const settingsBy = new Map(settings.map((s) => [s.userId, s]));
  const profileBy = new Map(profiles.map((p) => [p.userId, p.profile]));
  const rows = holdings.map((h): MatchingRow => {
    const holding: TradeHolding = { packId: h.packId, bidPackMeta: meta, lineNumber: h.lineNumber, trips: h.trips, ...(h.carryIn ? { carryIn: h.carryIn } : {}), confirmedAt: h.confirmedAt.toISOString() };
    const s = settingsBy.get(h.userId);
    return { userId: h.userId, holding, settings: { suggestMe: s?.suggestMe ?? true, emailMatches: s?.emailMatches ?? false }, profile: profileBy.get(h.userId) ?? null };
  });
  return { rows, names: new Map(people.map((p) => [p.id, p.displayName])), fingerprints: new Map(holdings.map((h) => [h.userId, h.packFingerprint ?? null])) };
}

/**
 * What the matching must steer around in a group: pilots already on an open trade, trades already suggested, what
 * pilots have said no to, and the trips in trades agreed on the board (`boardTrips`: spoken for, so not to be handed on).
 * A pilot who didn't want a trip isn't offered it again, whatever they'd give for it; one who said a trade wasn't worth
 * it needs more than that trade's gain next time.
 */
export async function matchingHistory(meta: BidPackMetaSnapshot, now: Date) {
  const agreed = await db
    .select()
    .from(tradeOffers)
    .where(and(eq(tradeOffers.base, meta.base), eq(tradeOffers.aircraft, meta.aircraft), eq(tradeOffers.seat, meta.seat), eq(tradeOffers.month, meta.month), eq(tradeOffers.status, "accepted")));
  const offers = agreed.map((o): TradeOffer => ({
    id: o.id,
    bidPackMeta: bidPackMetaOf(o),
    offeringUserId: o.offeringUserId,
    offeringDisplayName: o.offeringDisplayName,
    offeredTrip: o.offeredTrip,
    wantedPairingNumber: o.wantedPairingNumber,
    note: o.note,
    status: "accepted",
    createdAt: o.createdAt.toISOString(),
    responderUserId: o.responderUserId,
    responderDisplayName: o.responderDisplayName,
    responderTrip: o.responderTrip,
    respondedAt: o.respondedAt?.toISOString() ?? null,
    resolvedAt: o.resolvedAt?.toISOString() ?? null,
  }));
  const boardTrips: GivenTrip[] = agreedBoardTrips(offers);
  const empty = {
    boardTrips,
    /** What each pilot takes in those trades: a trip handed them must fit beside it until it goes through. */
    boardSwaps: agreedBoardSwaps(offers),
    busyPilots: new Set<string>(),
    signatures: new Set<string>(),
    declined: new Set<string>(),
    refusedTrips: new Set<string>(),
    minGains: new Map<string, number>(),
    /** Pilots who said a trade wasn't what they hold, and when: not matched again until they confirm what they do hold. */
    holdingDoubted: new Map<string, Date>(),
  };
  const rows = await db.select().from(tradeSuggestions).where(suggestionGroupIs(meta));
  if (!rows.length) return empty;
  const members = await db.select().from(tradeSuggestionMembers).where(inArray(tradeSuggestionMembers.suggestionId, rows.map((r) => r.id)));
  const bySuggestion = new Map<string, MemberRow[]>();
  for (const m of members) bySuggestion.set(m.suggestionId, [...(bySuggestion.get(m.suggestionId) ?? []), m]);
  const { busyPilots, declined, refusedTrips, minGains, holdingDoubted } = empty;
  const recently = (at: Date | null) => !!at && now.getTime() - at.getTime() <= NOT_NOW_DAYS * DAY_MS;
  for (const r of rows) {
    const part = (bySuggestion.get(r.id) ?? []).sort((a, b) => a.position - b.position);
    const open = (r.status === "proposed" || r.status === "accepted") && (r.stepsDone > 0 || r.expiresAt > now);
    if (open) for (const m of part) busyPilots.add(m.userId);
    part.forEach((m, i) => {
      const take = part[(i + 1) % part.length].give;
      // Never answered, so it lapsed: as "not right now" for them, or the same trade comes straight back and holds
      // everyone who said yes for the same silent pilot again.
      if (r.cancelReason === "unanswered" && m.answer === "waiting") {
        if (recently(r.resolvedAt)) declined.add(swapKey(m.userId, m.give, take));
        return;
      }
      if (m.answer !== "declined") return;
      // What they held was wrong: nothing to say about the swap, but nothing to match them on until they fix it.
      if (m.declineReason === "wrongHolding") {
        if (m.answeredAt && m.answeredAt > (holdingDoubted.get(m.userId) ?? new Date(0))) holdingDoubted.set(m.userId, m.answeredAt);
        return;
      }
      // "Not right now" is for now: the swap can come back once a few days have gone by.
      if (m.declineReason === "notNow" && !recently(m.answeredAt)) return;
      declined.add(swapKey(m.userId, m.give, take));
      if (m.declineReason === "trip") refusedTrips.add(refusedTripKey(m.userId, take));
      if (m.declineReason === "notWorthIt") minGains.set(m.userId, Math.max(minGains.get(m.userId) ?? 0, m.value.gain + NOT_WORTH_IT_MARGIN));
    });
  }
  return { ...empty, signatures: new Set(rows.flatMap((r) => (r.signature ? [r.signature] : []))) };
}

/** How much more than a declined trade's gain the next one must offer a pilot who said it wasn't worth it. */
const NOT_WORTH_IT_MARGIN = 1;
const DAY_MS = 24 * 3_600_000;
/** How long "Not right now" holds a swap back. */
const NOT_NOW_DAYS = 3;
/**
 * How long a suggested trade waits for everyone's answer. Emails are off by default, so a pilot who never comes back
 * would otherwise keep the rest (some of whom said yes) out of every other trade until the trip's own deadline.
 */
export const ANSWER_DAYS = 3;

/** Calls off this group's suggested trades that have waited `ANSWER_DAYS` for an answer, freeing their pilots. */
export async function lapseUnanswered(meta: BidPackMetaSnapshot, now: Date): Promise<void> {
  await db
    .update(tradeSuggestions)
    .set({ status: "cancelled", cancelReason: "unanswered", signature: null, resolvedAt: now })
    .where(and(suggestionGroupIs(meta), eq(tradeSuggestions.status, "proposed"), lt(tradeSuggestions.createdAt, new Date(now.getTime() - ANSWER_DAYS * DAY_MS))));
}

export const refusedTripKey = (userId: string, trip: { id: string; startDayIndex: number | null }) => `${userId}|${tripInstanceKey(trip)}`;

export const swapKey = (userId: string, give: { id: string; startDayIndex: number | null }, take: { id: string; startDayIndex: number | null }) =>
  `${userId}|${tripInstanceKey(give)}|${tripInstanceKey(take)}`;

/**
 * Stores a found trade. False if the same trade was stored first by another lookup, or (given `foundFrom`, when the run
 * read the group) if it no longer stands: a pilot on it changed what they hold since then, gave up the trip, turned
 * suggestions off or was put on another trade. The holdings stay locked until it's stored, so a change made meanwhile
 * waits and then lapses it as usual.
 */
export async function saveSuggestion(s: ReturnType<typeof suggestionToStore>, foundFrom?: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The run read the board before a search of up to a minute: a trip agreed there since is spoken for. Under the
    // pilots' seat locks, so an accept on the board can't land between this check and the insert. And any board trade one
    // of them agreed since changes what they'll hold, a trip taken there as much as one given: the search fitted what it
    // handed them around what they held before.
    await lockPilotsInSeat(tx, s.bidPackMeta, s.members.map((m) => m.userId));
    const agreed = await agreedTrades(tx, s.bidPackMeta, [...new Set(s.members.map((m) => m.userId))]);
    if (s.members.some((m) => alreadyTraded(agreed, s.bidPackMeta, m.userId, m.give))) return false;
    if (foundFrom && agreed.some((o) => o.resolvedAt !== null && Date.parse(o.resolvedAt) > foundFrom.getTime())) return false;
    if (foundFrom && !(await stillStands(tx, s, foundFrom))) return false;
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Whether one of these pilots has agreed on the board to trade away the trip they'd give here. The caller holds their seat locks. */
async function givesAgreedTrip(tx: Tx, meta: BidPackMetaSnapshot, gives: readonly { userId: string; give: TradeTrip }[]): Promise<boolean> {
  const agreed = await agreedTrades(tx, meta, [...new Set(gives.map((g) => g.userId))]);
  return gives.some((g) => alreadyTraded(agreed, meta, g.userId, g.give));
}

/**
 * Takes everyone's seat locks, in the board's order (`lockPilotsInSeat`), before the trade's own row is locked: a board
 * accept checking this trade then waits for it, or it for the accept, and never each for the other.
 */
async function lockMembersInSeat(tx: Tx, id: string): Promise<boolean> {
  const [seen] = await tx.select().from(tradeSuggestions).where(eq(tradeSuggestions.id, id));
  if (!seen) return false;
  const onIt = await tx.select({ userId: tradeSuggestionMembers.userId }).from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.suggestionId, id));
  await lockPilotsInSeat(tx, bidPackMetaOf(seen), onIt.map((m) => m.userId));
  return true;
}

async function stillStands(tx: Tx, s: ReturnType<typeof suggestionToStore>, foundFrom: Date): Promise<boolean> {
  const ids = s.members.map((m) => m.userId);
  const held = await tx.select().from(tradeHoldings).where(and(inArray(tradeHoldings.userId, ids), inArray(tradeHoldings.packId, packIdsOf(s.packId, s.bidPackMeta)))).for("update");
  const byUser = new Map(held.map((h) => [h.userId, h]));
  const holdsIt = s.members.every((m) => {
    // Under the pack's own id when they have one there (as `listMatchingGroup` picks), or else its older one.
    const h = held.find((x) => x.userId === m.userId && x.packId === s.packId) ?? byUser.get(m.userId);
    return !!h && h.confirmedAt <= foundFrom && h.trips.some((t) => tripInstanceKey(t) === tripInstanceKey(m.give));
  });
  if (!holdsIt) return false;
  const [off] = await tx.select({ userId: tradePreferences.userId }).from(tradePreferences).where(and(inArray(tradePreferences.userId, ids), eq(tradePreferences.suggestMe, false))).limit(1);
  if (off) return false;
  const [busy] = await tx
    .select({ userId: tradeSuggestionMembers.userId })
    .from(tradeSuggestionMembers)
    .innerJoin(tradeSuggestions, eq(tradeSuggestions.id, tradeSuggestionMembers.suggestionId))
    .where(and(inArray(tradeSuggestionMembers.userId, ids), eq(tradeSuggestions.packId, s.packId), inArray(tradeSuggestions.status, ["proposed", "accepted"]), or(gt(tradeSuggestions.stepsDone, 0), gt(tradeSuggestions.expiresAt, new Date()))))
    .limit(1);
  return !busy;
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
 * locked, so two pilots answering together can't each miss the other's yes. A yes to a trade one of whose trips has
 * since been agreed on the board calls it off instead, as a change to what they hold would (`lapseSuggestionsFor`).
 */
export async function answerSuggestion(id: string, userId: string, answer: Exclude<TradeAnswer, "waiting">, now = new Date(), declineReason: TradeDeclineReason | null = null): Promise<AnswerResult> {
  return db.transaction(async (tx) => {
    if (!(await lockMembersInSeat(tx, id))) return { ok: false, reason: "not-found" } as const;
    const [row] = await tx.select().from(tradeSuggestions).where(eq(tradeSuggestions.id, id)).for("update");
    if (!row) return { ok: false, reason: "not-found" } as const;
    const members = await tx.select().from(tradeSuggestionMembers).where(eq(tradeSuggestionMembers.suggestionId, id));
    const me = members.find((m) => m.userId === userId);
    if (!me) return { ok: false, reason: "not-found" } as const;
    if (row.status !== "proposed" || row.expiresAt <= now || !isWhole({ members: toRecord(row, members).members, steps: row.steps })) return { ok: false, reason: "closed" } as const;
    if (answer === "accepted" && (await givesAgreedTrip(tx, bidPackMetaOf(row), members))) {
      const [called] = await tx.update(tradeSuggestions).set({ status: "cancelled", cancelReason: "changed", signature: null, resolvedAt: now }).where(eq(tradeSuggestions.id, id)).returning();
      return { ok: true, record: toRecord(called, members) } as const;
    }
    await tx.update(tradeSuggestionMembers).set({ answer, answeredAt: now, declineReason: answer === "declined" ? declineReason : null }).where(eq(tradeSuggestionMembers.id, me.id));
    const after = members.map((m) => (m.id === me.id ? { ...m, answer } : m));
    const next =
      answer === "declined"
        ? {
            status: "cancelled" as const,
            cancelReason: "declined" as const,
            resolvedAt: now,
            // Kept, the signature would stop this exact trade ever being suggested again; these reasons don't mean never.
            ...(declineReason === "notNow" || declineReason === "wrongHolding" ? { signature: null } : {}),
          }
        : after.every((m) => m.answer === "accepted")
          ? { status: "accepted" as const }
          : null;
    const [updated] = next ? await tx.update(tradeSuggestions).set(next).where(eq(tradeSuggestions.id, id)).returning() : [row];
    return { ok: true, record: toRecord(updated, after) } as const;
  });
}

export type StepResult = { ok: true; record: TradeSuggestionRecord } | { ok: false; reason: "not-found" | "not-yours" | "not-next" | "traded" };

/**
 * A pilot says the next trade in the order went through. Either of the two can say so. What both pilots hold moves with
 * it, so a chain stopped partway still shows each of them what they really have, and the board lets go of the trips
 * that moved: their offers of them are withdrawn, and proposals made with them taken off (`freeOffersOfMovedTrips`).
 */
export async function markStepDone(id: string, userId: string, stepIndex: number, now = new Date()): Promise<StepResult> {
  return db.transaction(async (tx) => {
    if (!(await lockMembersInSeat(tx, id))) return { ok: false, reason: "not-found" } as const;
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
    // A trip agreed on the board since (in a race the board's own checks can't see) isn't the trade's to move.
    const moving = [step.a, step.b].map((p) => ({ userId: pilot(p).userId, give: pilot(holds[p]).give }));
    if (await givesAgreedTrip(tx, record.bidPackMeta, moving)) {
      // The chain can't go on, and left "accepted" it kept every pilot on it out of other trades for the rest of the
      // month. It ends here; the steps already done stay done, in VIPS and on each pilot's holding.
      await tx.update(tradeSuggestions).set({ status: "cancelled", cancelReason: "changed", signature: null, resolvedAt: now }).where(eq(tradeSuggestions.id, id));
      return { ok: false, reason: "traded" } as const;
    }
    const swap = async (position: number, other: number) => {
      const giving = pilot(holds[position]).give;
      const taking = pilot(holds[other]).give;
      const rows = await tx.select().from(tradeHoldings).where(and(eq(tradeHoldings.userId, pilot(position).userId), inArray(tradeHoldings.packId, packIdsOf(row.packId, record.bidPackMeta)))).for("update");
      const held = rows.find((h) => h.packId === row.packId) ?? rows[0];
      if (!held) return;
      const trips = [...held.trips.filter((t) => tripInstanceKey(t) !== tripInstanceKey(giving)), { id: taking.id, startDayIndex: taking.startDayIndex, lock: null }].sort((x, y) => x.startDayIndex - y.startDayIndex);
      await tx.update(tradeHoldings).set({ trips, confirmedAt: now }).where(eq(tradeHoldings.id, held.id));
    };
    await swap(step.a, step.b);
    await swap(step.b, step.a);
    await freeOffersOfMovedTrips(
      tx,
      record.bidPackMeta,
      [
        { pilot: pilot(step.a).userId, trip: pilot(holds[step.a]).give },
        { pilot: pilot(step.b).userId, trip: pilot(holds[step.b]).give },
      ],
      now
    );

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

/** Every month and seat where at least `min` pilots have confirmed what they hold. */
export async function listActiveGroups(min: number): Promise<BidPackMetaSnapshot[]> {
  const rows = await db
    // Pilots, not holdings: one confirmed under the pack's older id and its own is one pilot. Confirmed accounts only.
    .select({ base: tradeHoldings.base, aircraft: tradeHoldings.aircraft, seat: tradeHoldings.seat, month: tradeHoldings.month, n: countDistinct(tradeHoldings.userId) })
    .from(tradeHoldings)
    .where(inArray(tradeHoldings.userId, verifiedUserIds()))
    .groupBy(tradeHoldings.base, tradeHoldings.aircraft, tradeHoldings.seat, tradeHoldings.month);
  return rows.filter((r) => r.n >= min).map(({ base, aircraft, seat, month }) => ({ base, aircraft, seat, month }));
}

/** The address and name of those on a trade who want an email about it. Someone who turned suggestions off gets none. */
export async function listTradeEmailTargets(userIds: readonly string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, suggestMe: tradePreferences.suggestMe, emailMatches: tradePreferences.emailMatches })
    .from(tradePreferences)
    .innerJoin(users, eq(users.id, tradePreferences.userId))
    .where(inArray(tradePreferences.userId, [...userIds]));
  return new Map(rows.filter((r) => r.emailMatches && r.suggestMe).map((r) => [r.id, r.email]));
}

export interface TradeDayCounts {
  suggested: Record<number, number>;
  yes: number;
  no: number;
  noBecause: Partial<Record<TradeDeclineReason, number>>;
  finished: number;
  lapsed: number;
}

/** What happened to suggested trades over a span: for the owner's daily email, to see whether suggestions are any good. */
export async function tradeDayCounts(from: Date, to: Date): Promise<TradeDayCounts> {
  const within = (c: Parameters<typeof gte>[0]) => and(gte(c, from), lt(c, to));
  const [created, answers, resolved] = await Promise.all([
    db.select({ steps: tradeSuggestions.steps }).from(tradeSuggestions).where(within(tradeSuggestions.createdAt)),
    db.select({ answer: tradeSuggestionMembers.answer, reason: tradeSuggestionMembers.declineReason }).from(tradeSuggestionMembers).where(within(tradeSuggestionMembers.answeredAt)),
    db.select({ status: tradeSuggestions.status, why: tradeSuggestions.cancelReason }).from(tradeSuggestions).where(within(tradeSuggestions.resolvedAt)),
  ]);
  const out: TradeDayCounts = { suggested: {}, yes: 0, no: 0, noBecause: {}, finished: 0, lapsed: 0 };
  for (const c of created) out.suggested[c.steps.length + 1] = (out.suggested[c.steps.length + 1] ?? 0) + 1;
  for (const a of answers) {
    if (a.answer === "accepted") out.yes++;
    if (a.answer === "declined") {
      out.no++;
      if (a.reason) out.noBecause[a.reason] = (out.noBecause[a.reason] ?? 0) + 1;
    }
  }
  for (const r of resolved) {
    if (r.status === "done") out.finished++;
    if (r.status === "cancelled" && r.why === "changed") out.lapsed++;
  }
  return out;
}
