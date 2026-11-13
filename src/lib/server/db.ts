import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { AwardRow } from "@/lib/server/award-aggregate";
import { alreadyTraded, offersFreedByTrade } from "@/lib/trades/offer-trips";
import { packIdFor } from "@/lib/pack-id";
import { db } from "@/lib/server/postgres";
import {
  awardHistoryRecords,
  bidPackMetaOf,
  bidPacks,
  candidateVariables,
  credentials as credentialsTable,
  feedbackSubmissions,
  interviewCandidateFacts,
  passwordResetTokens,
  preferenceProfiles,
  sessions,
  tradeHoldings,
  tradeOffers,
  tradePreferences,
  users,
} from "@/lib/server/schema";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { Seat } from "@/types/bidpack";
import type { StoredCredential, UserAccount } from "@/types/auth";
import type { CandidateVariable } from "@/types/candidate-variable";
import type { FeedbackSubmission } from "@/types/feedback";
import type { InterviewCandidateFact } from "@/types/interview-candidate-fact";
import type { PreferenceProfile } from "@/types/preferences";
import type { BidPackMetaSnapshot, TradeHolding, TradeOffer, TradeOfferStatus, TradeSettings, TripSnapshot } from "@/types/trade";

/**
 * Real tables behind Postgres (`schema.ts`/`postgres.ts`) — replaces the old
 * single-JSON-blob store. Unique constraints and atomic conditional updates
 * (see `updateTradeOffer`, `createUserWithCredential`) are what actually
 * prevent two concurrent signups or trade responses from corrupting each
 * other; a read-modify-write blob could never guarantee that.
 */

export interface ServerSession {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface PasswordResetToken {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  // drizzle-orm wraps the driver's error in `DrizzleQueryError`, which puts the original on `.cause`.
  if ("cause" in err) return pgErrorCode((err as { cause?: unknown }).cause);
  return undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/**
 * `id`/`userId` columns are Postgres `uuid`, which throws (error 22P02,
 * "invalid input syntax for type uuid") rather than just not matching when
 * given a malformed string — unlike the old blob store's plain `===`
 * comparison, which just found nothing. The trade offer id in particular
 * comes straight from a URL path segment a client controls, so a garbage
 * value there must look like "not found," not crash the request. Every
 * lookup below checks this first rather than letting Postgres reject it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ---- Users & credentials ----

function toUserAccount(row: typeof users.$inferSelect): UserAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    plan: row.plan as UserAccount["plan"],
  };
}

function toStoredCredential(row: typeof credentialsTable.$inferSelect): StoredCredential {
  return {
    userId: row.userId,
    email: row.email,
    passwordHash: row.passwordHash,
    salt: row.salt,
    recoveryHash: row.recoveryHash ?? undefined,
    recoverySalt: row.recoverySalt ?? undefined,
  };
}

export async function findUserByEmail(email: string): Promise<UserAccount | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ? toUserAccount(row) : null;
}

export async function findUserById(id: string): Promise<UserAccount | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUserAccount(row) : null;
}

export async function findCredentialByEmail(email: string): Promise<StoredCredential | null> {
  const [row] = await db.select().from(credentialsTable).where(eq(credentialsTable.email, email)).limit(1);
  return row ? toStoredCredential(row) : null;
}

export async function findCredentialByUserId(userId: string): Promise<StoredCredential | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(credentialsTable).where(eq(credentialsTable.userId, userId)).limit(1);
  return row ? toStoredCredential(row) : null;
}

export type CreateUserResult = { ok: true } | { ok: false; reason: "duplicate-email" };

/**
 * Inserts the account and its credential in one transaction, and turns a
 * unique-constraint violation on `users.email` into a typed result instead
 * of throwing. This is the real guard against two concurrent signups for
 * the same email — `signUp()` in `auth.ts` also pre-checks
 * `findUserByEmail` for a fast, friendly error, but that check alone can't
 * close the race window; this one can, because the database enforces it.
 */
export async function createUserWithCredential(
  user: UserAccount,
  credential: StoredCredential
): Promise<CreateUserResult> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: new Date(user.createdAt),
        plan: user.plan ?? "free",
      });
      await tx.insert(credentialsTable).values({
        userId: credential.userId,
        email: credential.email,
        passwordHash: credential.passwordHash,
        salt: credential.salt,
        recoveryHash: credential.recoveryHash ?? null,
        recoverySalt: credential.recoverySalt ?? null,
      });
    });
    return { ok: true };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate-email" };
    throw err;
  }
}

export async function updateCredential(
  userId: string,
  patch: Partial<Pick<StoredCredential, "passwordHash" | "salt" | "recoveryHash" | "recoverySalt">>
): Promise<void> {
  const set: Partial<typeof credentialsTable.$inferInsert> = {};
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash;
  if (patch.salt !== undefined) set.salt = patch.salt;
  if (patch.recoveryHash !== undefined) set.recoveryHash = patch.recoveryHash;
  if (patch.recoverySalt !== undefined) set.recoverySalt = patch.recoverySalt;
  if (Object.keys(set).length === 0) return;
  await db.update(credentialsTable).set(set).where(eq(credentialsTable.userId, userId));
}

// ---- Password reset tokens ----

/** One live token per pilot — a single atomic upsert replaces the previous read-filter-push dance. */
export async function saveResetToken(token: PasswordResetToken): Promise<void> {
  await db
    .insert(passwordResetTokens)
    .values({ tokenHash: token.tokenHash, userId: token.userId, expiresAt: new Date(token.expiresAt) })
    .onConflictDoUpdate({
      target: passwordResetTokens.userId,
      set: { tokenHash: token.tokenHash, expiresAt: new Date(token.expiresAt) },
    });
}

/** Single-use: one atomic delete-and-return, so a link can never be replayed. */
export async function consumeResetToken(tokenHash: string): Promise<string | null> {
  const [row] = await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .returning();
  if (!row) return null;
  return row.expiresAt.getTime() > Date.now() ? row.userId : null;
}

// ---- Sessions ----

/**
 * Sessions are stored by a hash of their token, never the token itself: the cookie holds the token, the database
 * only its SHA-256, so a leaked copy of the table can't be used to sign in as anyone.
 *
 * Rows written before this rule (deployed 6 Nov 2026) held the token as it was, and were once looked up that way too,
 * then rewritten as its hash. That lookup is gone. A token is 64 hex characters (`startSession`) and so is its SHA-256,
 * so nothing about a value says which one it is; and a rewritten row kept its old expiry, so a hash copied out of the
 * table matched the old lookup and worked as a cookie, the very thing hashing is there to stop. A pilot whose row was
 * never rewritten (not back since 6 Nov) is asked to sign in again. Those rows can't be used any more, and all expire
 * by 6 Dec 2026; `scripts/purge-legacy-sessions.ts` clears them sooner.
 */
function sessionKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(session: ServerSession): Promise<void> {
  await db
    .insert(sessions)
    .values({ token: sessionKey(session.token), userId: session.userId, expiresAt: new Date(session.expiresAt) });
}

export async function findSession(token: string): Promise<ServerSession | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.token, sessionKey(token))).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return { token, userId: row.userId, expiresAt: row.expiresAt.toISOString() };
}

/** Signs a pilot out everywhere — used after a password reset, so a session someone else may be holding can't outlive the credential that created it. */
export async function deleteSessionsForUser(userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** By the hash only: also deleting a row stored as the value sent let anyone holding a hash from the table sign its pilot out. */
export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, sessionKey(token)));
}

// ---- Trade offers ----

function toTradeOffer(row: typeof tradeOffers.$inferSelect): TradeOffer {
  return {
    id: row.id,
    bidPackMeta: bidPackMetaOf(row),
    offeringUserId: row.offeringUserId,
    offeringDisplayName: row.offeringDisplayName,
    offeredTrip: row.offeredTrip,
    wantedPairingNumber: row.wantedPairingNumber,
    note: row.note,
    status: row.status as TradeOfferStatus,
    createdAt: row.createdAt.toISOString(),
    responderUserId: row.responderUserId,
    responderDisplayName: row.responderDisplayName,
    responderTrip: row.responderTrip,
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

const offersForSeat = (meta: BidPackMetaSnapshot) =>
  and(eq(tradeOffers.base, meta.base), eq(tradeOffers.aircraft, meta.aircraft), eq(tradeOffers.seat, meta.seat), eq(tradeOffers.month, meta.month));

/**
 * One seat's board for one month, as one pilot may see it: every offer they posted or proposed on, whatever its status,
 * and, when `othersOpen`, other pilots' open offers. Never other seats' offers, nor others' trades in progress. Each
 * part is the newest `limit`.
 */
export async function listTradeOffersForSeat(meta: BidPackMetaSnapshot, viewerId: string, opts: { othersOpen: boolean; limit: number }): Promise<TradeOffer[]> {
  if (!isUuid(viewerId)) return [];
  const [own, open] = await Promise.all([
    db
      .select()
      .from(tradeOffers)
      .where(and(offersForSeat(meta), or(eq(tradeOffers.offeringUserId, viewerId), eq(tradeOffers.responderUserId, viewerId))))
      .orderBy(desc(tradeOffers.createdAt))
      .limit(opts.limit),
    opts.othersOpen
      ? db
          .select()
          .from(tradeOffers)
          .where(and(offersForSeat(meta), eq(tradeOffers.status, "open"), ne(tradeOffers.offeringUserId, viewerId)))
          .orderBy(desc(tradeOffers.createdAt))
          .limit(opts.limit)
      : [],
  ]);
  return [...own, ...open].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toTradeOffer);
}

export async function findTradeOffer(id: string): Promise<TradeOffer | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
  return row ? toTradeOffer(row) : null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Any fixed number: the class of this app's per pilot, seat and month trade locks (two-key advisory locks, apart from the learning run's one-key lock). */
const TRADE_LOCK_CLASS = 4_820_113;

/**
 * Queues everything that could give away one of these pilots' trips in this seat's month (posting an offer, proposing
 * on one, agreeing one) behind any other under way, until the transaction ends. Row locks alone can't: they only lock
 * offers that already exist, and an offer posted a moment after an accept isn't one of them. Taken in one order, so
 * two transactions never wait on each other.
 */
async function lockPilotsInSeat(tx: Tx, meta: BidPackMetaSnapshot, pilots: string[]): Promise<void> {
  const keys = [...new Set(pilots)].map((p) => [p, meta.base, meta.aircraft, meta.seat, meta.month].join("|")).sort();
  for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(${TRADE_LOCK_CLASS}::int, hashtext(${key}))`);
}

/** The trades these pilots have agreed in this seat's month: the trips in them are spoken for (`alreadyTraded`). */
async function agreedTrades(tx: Tx, meta: BidPackMetaSnapshot, pilots: string[]): Promise<TradeOffer[]> {
  const rows = await tx
    .select()
    .from(tradeOffers)
    .where(and(offersForSeat(meta), eq(tradeOffers.status, "accepted"), or(inArray(tradeOffers.offeringUserId, pilots), inArray(tradeOffers.responderUserId, pilots))));
  return rows.map(toTradeOffer);
}

/** Posts an offer, unless the pilot has already agreed to trade that trip away this month. False when refused for that. */
export async function createTradeOffer(offer: TradeOffer): Promise<boolean> {
  if (!isUuid(offer.offeringUserId)) return false;
  return db.transaction(async (tx) => {
    await lockPilotsInSeat(tx, offer.bidPackMeta, [offer.offeringUserId]);
    if (alreadyTraded(await agreedTrades(tx, offer.bidPackMeta, [offer.offeringUserId]), offer.bidPackMeta, offer.offeringUserId, offer.offeredTrip)) return false;
    await tx.insert(tradeOffers).values({
      id: offer.id,
      createdAt: new Date(offer.createdAt),
      base: offer.bidPackMeta.base,
      aircraft: offer.bidPackMeta.aircraft,
      seat: offer.bidPackMeta.seat,
      month: offer.bidPackMeta.month,
      offeringUserId: offer.offeringUserId,
      offeringDisplayName: offer.offeringDisplayName,
      offeredTrip: offer.offeredTrip,
      wantedPairingNumber: offer.wantedPairingNumber,
      note: offer.note,
      status: offer.status,
      responderUserId: offer.responderUserId,
      responderDisplayName: offer.responderDisplayName,
      responderTrip: offer.responderTrip,
      respondedAt: offer.respondedAt ? new Date(offer.respondedAt) : null,
      resolvedAt: offer.resolvedAt ? new Date(offer.resolvedAt) : null,
    });
    return true;
  });
}

/**
 * A pilot's proposal on an open offer, with their own trip. "traded" when either trip is already in a trade one of the
 * two pilots agreed this month; null when the offer isn't open any more (another pilot's proposal got there first).
 */
export async function respondToTradeOffer(
  id: string,
  responder: { id: string; displayName: string },
  responderTrip: TripSnapshot,
  now = new Date()
): Promise<TradeOffer | "traded" | null> {
  if (!isUuid(id) || !isUuid(responder.id)) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!row || row.status !== "open") return null;
    const meta = bidPackMetaOf(row);
    const pilots = [row.offeringUserId, responder.id];
    await lockPilotsInSeat(tx, meta, pilots);
    const agreed = await agreedTrades(tx, meta, pilots);
    if (alreadyTraded(agreed, meta, row.offeringUserId, row.offeredTrip) || alreadyTraded(agreed, meta, responder.id, responderTrip)) return "traded";
    const [updated] = await tx
      .update(tradeOffers)
      .set({ status: "pending", responderUserId: responder.id, responderDisplayName: responder.displayName, responderTrip, respondedAt: now })
      .where(and(eq(tradeOffers.id, id), eq(tradeOffers.status, "open")))
      .returning();
    return updated ? toTradeOffer(updated) : null;
  });
}

/**
 * Atomically applies `patch` only if the offer's current status is still
 * one of `expectedStatuses` — `UPDATE ... WHERE id = $1 AND status = ANY($2)`
 * in one round trip. Returns null when the row doesn't exist *or* its
 * status already moved out from under the caller (e.g. a second pilot's
 * response arriving a beat after the first already claimed it) — the
 * caller can't tell those apart from this alone, but both mean "don't treat
 * this as your update," which is all every route actually needs.
 */
export async function updateTradeOffer(
  id: string,
  patch: Partial<TradeOffer>,
  expectedStatuses: TradeOfferStatus[]
): Promise<TradeOffer | null> {
  if (!isUuid(id)) return null;
  const set: Partial<typeof tradeOffers.$inferInsert> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.responderUserId !== undefined) set.responderUserId = patch.responderUserId;
  if (patch.responderDisplayName !== undefined) set.responderDisplayName = patch.responderDisplayName;
  if (patch.responderTrip !== undefined) set.responderTrip = patch.responderTrip;
  if (patch.respondedAt !== undefined) set.respondedAt = patch.respondedAt ? new Date(patch.respondedAt) : null;
  if (patch.resolvedAt !== undefined) set.resolvedAt = patch.resolvedAt ? new Date(patch.resolvedAt) : null;

  const [row] = await db
    .update(tradeOffers)
    .set(set)
    .where(and(eq(tradeOffers.id, id), inArray(tradeOffers.status, expectedStatuses)))
    .returning();
  return row ? toTradeOffer(row) : null;
}

/**
 * Accepts a pending offer, and in the same transaction frees every other offer that gave away either of its trips
 * (`offersFreedByTrade`): the pilots' other offers of them are withdrawn, and a proposal one of them made with one is
 * taken off that offer, which opens again. Both pilots' locks for that seat and month are taken first
 * (`lockPilotsInSeat`), then every offer either is on is locked, in one order, so two accepts that share a trip queue
 * up rather than both going through. Null when the offer isn't pending, or its proposal isn't the one
 * `expectedRespondedAt` names (one taken off and replaced since it was seen); "traded" when either trip is already in
 * a trade one of the pilots agreed.
 */
export async function acceptTradeOffer(id: string, expectedRespondedAt: string | null, now = new Date()): Promise<TradeOffer | "traded" | null> {
  if (!isUuid(id)) return null;
  return db.transaction(async (tx) => {
    const [first] = await tx.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!first?.responderUserId || first.status !== "pending") return null;
    const pilots = [first.offeringUserId, first.responderUserId];
    await lockPilotsInSeat(tx, bidPackMetaOf(first), pilots);
    const rows = await tx
      .select()
      .from(tradeOffers)
      .where(and(offersForSeat(bidPackMetaOf(first)), or(inArray(tradeOffers.offeringUserId, pilots), inArray(tradeOffers.responderUserId, pilots))))
      .orderBy(tradeOffers.id)
      .for("update");
    const locked = rows.find((r) => r.id === id);
    if (!locked || locked.status !== "pending" || locked.responderUserId !== first.responderUserId) return null;
    if (expectedRespondedAt && locked.respondedAt?.toISOString() !== expectedRespondedAt) return null;
    const offer = toTradeOffer(locked);
    const others = rows.filter((r) => r.id !== id).map(toTradeOffer);
    const given = [
      { pilot: locked.offeringUserId, trip: locked.offeredTrip },
      ...(locked.responderTrip ? [{ pilot: first.responderUserId, trip: locked.responderTrip }] : []),
    ];
    if (given.some((g) => alreadyTraded(others, offer.bidPackMeta, g.pilot, g.trip))) return "traded";
    const { withdraw, reopen } = offersFreedByTrade(offer, others);
    const [row] = await tx.update(tradeOffers).set({ status: "accepted", resolvedAt: now }).where(eq(tradeOffers.id, id)).returning();
    if (withdraw.length > 0) await tx.update(tradeOffers).set({ status: "withdrawn", resolvedAt: now }).where(inArray(tradeOffers.id, withdraw));
    if (reopen.length > 0) {
      await tx
        .update(tradeOffers)
        .set({ status: "open", responderUserId: null, responderDisplayName: null, responderTrip: null, respondedAt: null })
        .where(inArray(tradeOffers.id, reopen));
    }
    return toTradeOffer(row);
  });
}

// ---- Candidate variables ----

export async function listCandidateVariables(): Promise<CandidateVariable[]> {
  const rows = await db.select().from(candidateVariables).orderBy(desc(candidateVariables.createdAt));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createCandidateVariable(candidate: CandidateVariable): Promise<void> {
  await db.insert(candidateVariables).values({ ...candidate, createdAt: new Date(candidate.createdAt) });
}

// ---- Interview candidate facts ----

export async function listInterviewCandidateFacts(): Promise<InterviewCandidateFact[]> {
  const rows = await db.select().from(interviewCandidateFacts).orderBy(desc(interviewCandidateFacts.createdAt));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function createInterviewCandidateFact(fact: InterviewCandidateFact): Promise<void> {
  await db.insert(interviewCandidateFacts).values({ ...fact, createdAt: new Date(fact.createdAt) });
}

// ---- Award history ----

const AWARD_ROW = {
  pilotHash: awardHistoryRecords.pilotHash,
  seniorityRank: awardHistoryRecords.seniorityRank,
  seniorityTotalPilots: awardHistoryRecords.seniorityTotalPilots,
  outcome: awardHistoryRecords.outcome,
  lineNumber: awardHistoryRecords.lineNumber,
  daysOff: awardHistoryRecords.daysOff,
  totalCreditHours: awardHistoryRecords.totalCreditHours,
  holderShown: awardHistoryRecords.holderShown,
  submittedAt: awardHistoryRecords.submittedAt,
};

/** The rows group numbers are worked out from. Server-side only: `lib/server/award-aggregate.ts` is what a client gets to see of them. */
export async function listAwardRowsForSeat(filter: { base: string; aircraft: string; seat: string }): Promise<AwardRow[]> {
  return db
    .select(AWARD_ROW)
    .from(awardHistoryRecords)
    .where(and(eq(awardHistoryRecords.base, filter.base), eq(awardHistoryRecords.aircraft, filter.aircraft), eq(awardHistoryRecords.seat, filter.seat)));
}

export async function listAwardRowsForPack(packKey: string): Promise<AwardRow[]> {
  return db.select(AWARD_ROW).from(awardHistoryRecords).where(eq(awardHistoryRecords.packKey, packKey));
}

/** Removes a pilot's own shares: one pack's, or all of them. Returns how many went. */
export async function deleteAwardShares(pilotHash: string, packKey?: string): Promise<number> {
  const removed = await db
    .delete(awardHistoryRecords)
    .where(packKey ? and(eq(awardHistoryRecords.pilotHash, pilotHash), eq(awardHistoryRecords.packKey, packKey)) : eq(awardHistoryRecords.pilotHash, pilotHash))
    .returning({ id: awardHistoryRecords.id });
  return removed.length;
}

/** How many accounts have had a real pack of this kind on the server since `since`. An uploaded pack's id starts with its base, aircraft and seat. */
export async function countRecentPilotsWithPack(packIdPrefix: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bidPacks)
    .where(and(sql`starts_with(${bidPacks.packId}, ${packIdPrefix})`, gte(bidPacks.updatedAt, since)));
  return row?.n ?? 0;
}

/**
 * Stores one pilot's award report. In `link`, a field left undefined is one the report didn't say: a replaced report's
 * answer stands (see below). Null or false is an answer.
 */
export async function createAwardHistoryRecord(
  record: AwardHistoryRecord,
  link: { pilotHash?: string | null; packKey?: string | null; awardedChoice?: number | null; monthFeel?: string | null; brainVersion?: number | null; notesUsed?: boolean | null; holderShown?: boolean } = {}
): Promise<void> {
  const t = awardHistoryRecords;
  const now = new Date();
  const report = {
    id: record.id,
    base: record.base,
    aircraft: record.aircraft,
    seat: record.seat,
    month: record.month,
    seniorityRank: record.seniorityRank,
    seniorityTotalPilots: record.seniorityTotalPilots,
    outcome: record.outcome,
    lineNumber: record.lineNumber,
    daysOff: record.daysOff,
    totalCreditHours: record.totalCreditHours,
    totalTafbHours: record.totalTafbHours,
    submittedAt: new Date(record.submittedAt),
    awardedChoice: link.awardedChoice ?? null,
  };
  const insert = db.insert(t).values({
    ...report,
    pilotHash: link.pilotHash ?? null,
    packKey: link.packKey ?? null,
    holderShown: link.holderShown ?? false,
    monthFeel: link.monthFeel ?? null,
    checkedInAt: link.monthFeel ? now : null,
    brainVersion: link.brainVersion ?? null,
    notesUsed: link.notesUsed ?? null,
  });
  if (!link.pilotHash || !link.packKey) {
    await insert;
    return;
  }
  // One report per pilot per pack: a corrected award replaces the earlier one rather than standing beside it in the
  // history everyone's holdability estimates are checked against. One statement against the unique index, so two
  // reports sent at once can't both find nothing to replace and both be stored.
  //
  // A report that leaves out how the month flew, which brain ranked it, or the pilot's yes to showing their number
  // (Strategies' form asks none of these) keeps what the report it replaces said: otherwise reporting the award there
  // after the Logbook took the pilot's "Held by" share away. Their number stays shown only for a line at the same
  // seniority number they agreed to show.
  const isLine = record.outcome === "line" && !!record.lineNumber;
  await insert.onConflictDoUpdate({
    target: [t.pilotHash, t.packKey],
    targetWhere: sql`${t.pilotHash} is not null and ${t.packKey} is not null`,
    set: {
      ...report,
      // Its place in the order stays where the first report put it: moved to newest by a correction or a re-share, it
      // dropped out of the whole steps the group numbers are made from, and the change gave its values away.
      submittedAt: sql`${t.submittedAt}`,
      holderShown: link.holderShown ?? (isLine ? sql`${t.holderShown} and ${t.seniorityRank} = ${record.seniorityRank}` : false),
      ...(link.monthFeel !== undefined && { monthFeel: link.monthFeel, checkedInAt: link.monthFeel ? now : null }),
      ...(link.brainVersion !== undefined && { brainVersion: link.brainVersion }),
      ...(link.notesUsed !== undefined && { notesUsed: link.notesUsed }),
    },
  });
}

// ---- Preference profiles ----

/**
 * A pilot's preference profile used to live only in that browser's
 * localStorage — meaning it never survived a device change, and (a real,
 * live-confirmed bug) the app was also nulling it out client-side on every
 * new bid pack confirmation, before the next interview ever got a chance to
 * treat it as a prior cycle. This is the server-verified source of truth a
 * signed-in pilot's profile now round-trips through instead, so the
 * cross-cycle "returning pilot" logic in interview-engine.ts actually has
 * something real to fold against, on any device.
 */
export async function getPreferenceProfile(userId: string): Promise<PreferenceProfile | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(preferenceProfiles).where(eq(preferenceProfiles.userId, userId)).limit(1);
  return row ? row.profile : null;
}

export async function savePreferenceProfile(userId: string, profile: PreferenceProfile): Promise<void> {
  if (!isUuid(userId)) return;
  await db
    .insert(preferenceProfiles)
    .values({ userId, profile, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: preferenceProfiles.userId,
      set: { profile, updatedAt: new Date() },
    });
}

/** A pilot's latest bid pack, stored gzipped (see `bidPacks` in schema.ts). */
export async function getBidPackRecord(userId: string): Promise<{ packId: string; data: Buffer; updatedAt: string; fingerprint: string | null } | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(bidPacks).where(eq(bidPacks.userId, userId)).limit(1);
  return row ? { packId: row.packId, data: row.data, updatedAt: row.updatedAt.toISOString(), fingerprint: row.fingerprint ?? null } : null;
}

export async function saveBidPackRecord(userId: string, packId: string, data: Buffer, fingerprint: string | null = null): Promise<void> {
  if (!isUuid(userId)) return;
  const now = new Date();
  await db
    .insert(bidPacks)
    .values({ userId, packId, data, fingerprint, updatedAt: now })
    .onConflictDoUpdate({ target: bidPacks.userId, set: { packId, data, fingerprint, updatedAt: now } });
}

/** Keeps a fingerprint worked out for a pack saved before they were kept, if the account still holds that pack. */
export async function setBidPackFingerprint(userId: string, packId: string, fingerprint: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.update(bidPacks).set({ fingerprint }).where(and(eq(bidPacks.userId, userId), eq(bidPacks.packId, packId), isNull(bidPacks.fingerprint)));
}

/** A pack with this fingerprint from any of these pilots' accounts: the one a group is matched on. */
export async function bidPackRecordWithFingerprint(userIds: string[], fingerprint: string): Promise<{ userId: string; packId: string; data: Buffer } | null> {
  const ids = userIds.filter(isUuid);
  if (!ids.length) return null;
  const [row] = await db.select().from(bidPacks).where(and(inArray(bidPacks.userId, ids), eq(bidPacks.fingerprint, fingerprint))).limit(1);
  return row ? { userId: row.userId, packId: row.packId, data: row.data } : null;
}

export async function deleteBidPackRecord(userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.delete(bidPacks).where(eq(bidPacks.userId, userId));
}

function holdingOf(row: typeof tradeHoldings.$inferSelect): TradeHolding {
  return { packId: row.packId, bidPackMeta: bidPackMetaOf(row), lineNumber: row.lineNumber, trips: row.trips, confirmedAt: row.confirmedAt.toISOString() };
}

/** What a pilot has confirmed they hold in this pack. */
export async function getTradeHolding(userId: string, packId: string): Promise<TradeHolding | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(tradeHoldings).where(and(eq(tradeHoldings.userId, userId), eq(tradeHoldings.packId, packId))).limit(1);
  return row ? holdingOf(row) : null;
}

/**
 * Whether this seat's month is one the pilot flies: a holding they confirmed in it, or the uploaded pack on their
 * account. Only then do they see other pilots' offers on its board, post to it or answer an offer on it: a seat named
 * in a request proves nothing. A holding counts only under that seat's own pack id: one saved before the holding PUT
 * checked its seat against its pack could name any seat at all.
 */
export async function pilotHasSeatMonth(userId: string, meta: BidPackMetaSnapshot): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const packId = packIdFor({ ...meta, seat: meta.seat as Seat });
  const [held] = await db
    .select({ id: tradeHoldings.id })
    .from(tradeHoldings)
    .where(
      and(
        eq(tradeHoldings.userId, userId),
        eq(tradeHoldings.packId, packId),
        eq(tradeHoldings.base, meta.base),
        eq(tradeHoldings.aircraft, meta.aircraft),
        eq(tradeHoldings.seat, meta.seat),
        eq(tradeHoldings.month, meta.month)
      )
    )
    .limit(1);
  if (held) return true;
  const [pack] = await db.select({ packId: bidPacks.packId }).from(bidPacks).where(eq(bidPacks.userId, userId)).limit(1);
  return pack?.packId === packId;
}

/** What a pilot holds, confirmed on the pack whose fingerprint is given (null when their account doesn't have it yet). */
export async function saveTradeHolding(userId: string, holding: Omit<TradeHolding, "confirmedAt">, packFingerprint: string | null = null): Promise<TradeHolding | null> {
  if (!isUuid(userId)) return null;
  const { packId, bidPackMeta, lineNumber, trips } = holding;
  const now = new Date();
  const [row] = await db
    .insert(tradeHoldings)
    .values({ userId, packId, ...bidPackMeta, lineNumber, trips, packFingerprint, confirmedAt: now })
    .onConflictDoUpdate({ target: [tradeHoldings.userId, tradeHoldings.packId], set: { ...bidPackMeta, lineNumber, trips, packFingerprint, confirmedAt: now } })
    .returning();
  return holdingOf(row);
}

/** Fills in the pack a holding confirmed before fingerprints were kept was confirmed on. */
export async function setHoldingFingerprint(userId: string, packId: string, packFingerprint: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db
    .update(tradeHoldings)
    .set({ packFingerprint })
    .where(and(eq(tradeHoldings.userId, userId), eq(tradeHoldings.packId, packId), isNull(tradeHoldings.packFingerprint)));
}

export async function deleteTradeHolding(userId: string, packId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.delete(tradeHoldings).where(and(eq(tradeHoldings.userId, userId), eq(tradeHoldings.packId, packId)));
}

/** A pilot's trade settings; the defaults until they change one. */
export async function getTradeSettings(userId: string): Promise<TradeSettings> {
  const defaults: TradeSettings = { suggestMe: true, emailMatches: false };
  if (!isUuid(userId)) return defaults;
  const [row] = await db.select().from(tradePreferences).where(eq(tradePreferences.userId, userId)).limit(1);
  return row ? { suggestMe: row.suggestMe, emailMatches: row.emailMatches } : defaults;
}

export async function saveTradeSettings(userId: string, settings: TradeSettings): Promise<void> {
  if (!isUuid(userId)) return;
  const now = new Date();
  await db.insert(tradePreferences).values({ userId, ...settings, updatedAt: now }).onConflictDoUpdate({ target: tradePreferences.userId, set: { ...settings, updatedAt: now } });
}

/** A pilot's saved profile with when it was last saved — the version a device has to start from to save over it. */
export interface ProfileRecord {
  profile: PreferenceProfile;
  updatedAt: string;
}

export async function getPreferenceProfileRecord(userId: string): Promise<ProfileRecord | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(preferenceProfiles).where(eq(preferenceProfiles.userId, userId)).limit(1);
  return row ? { profile: row.profile, updatedAt: row.updatedAt.toISOString() } : null;
}

/**
 * Saves a profile only over the version the device last saw: `base` is that version's `updatedAt`, or null when the
 * device saw none. Saved by someone else since (another device, another tab) and it isn't written — the caller gets
 * the newer copy back to merge with instead, so an older device can never silently overwrite a newer one.
 */
export async function savePreferenceProfileOver(
  userId: string,
  profile: PreferenceProfile,
  base: string | null
): Promise<{ saved: true; updatedAt: string } | { saved: false; current: ProfileRecord | null }> {
  if (!isUuid(userId)) return { saved: false, current: null };
  const now = new Date();
  if (base === null) {
    const [inserted] = await db.insert(preferenceProfiles).values({ userId, profile, updatedAt: now }).onConflictDoNothing().returning({ updatedAt: preferenceProfiles.updatedAt });
    if (inserted) return { saved: true, updatedAt: inserted.updatedAt.toISOString() };
  } else {
    const baseAt = new Date(base);
    if (!Number.isNaN(baseAt.getTime())) {
      // Rows saved before this check kept the database's microseconds; a millisecond's grace matches them to the copy a device holds.
      const [updated] = await db
        .update(preferenceProfiles)
        .set({ profile, updatedAt: now })
        .where(and(eq(preferenceProfiles.userId, userId), sql`${preferenceProfiles.updatedAt} < ${baseAt.toISOString()}::timestamptz + interval '1 millisecond'`))
        .returning({ updatedAt: preferenceProfiles.updatedAt });
      if (updated) return { saved: true, updatedAt: updated.updatedAt.toISOString() };
    }
  }
  const current = await getPreferenceProfileRecord(userId);
  // Cleared on another device since: nothing newer to keep, so this save stands.
  if (!current) {
    const [inserted] = await db.insert(preferenceProfiles).values({ userId, profile, updatedAt: now }).onConflictDoNothing().returning({ updatedAt: preferenceProfiles.updatedAt });
    if (inserted) return { saved: true, updatedAt: inserted.updatedAt.toISOString() };
  }
  return { saved: false, current };
}

export async function deletePreferenceProfile(userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.delete(preferenceProfiles).where(eq(preferenceProfiles.userId, userId));
}

// ---- Feedback ----

export async function createFeedbackSubmission(submission: FeedbackSubmission): Promise<void> {
  await db.insert(feedbackSubmissions).values({ ...submission, createdAt: new Date(submission.createdAt) });
}

export async function listFeedbackSubmissions(): Promise<FeedbackSubmission[]> {
  const rows = await db.select().from(feedbackSubmissions).orderBy(desc(feedbackSubmissions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    pilotId: row.pilotId,
    pilotDisplayName: row.pilotDisplayName,
    pilotEmail: row.pilotEmail,
    category: row.category as FeedbackSubmission["category"],
    message: row.message,
    page: row.page,
    createdAt: row.createdAt.toISOString(),
  }));
}
