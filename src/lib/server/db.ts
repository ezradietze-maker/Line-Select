import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/server/postgres";
import {
  awardHistoryRecords,
  bidPackMetaOf,
  candidateVariables,
  credentials as credentialsTable,
  feedbackSubmissions,
  interviewCandidateFacts,
  passwordResetTokens,
  preferenceProfiles,
  sessions,
  tradeOffers,
  users,
} from "@/lib/server/schema";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { StoredCredential, UserAccount } from "@/types/auth";
import type { CandidateVariable } from "@/types/candidate-variable";
import type { FeedbackSubmission } from "@/types/feedback";
import type { InterviewCandidateFact } from "@/types/interview-candidate-fact";
import type { PreferenceProfile } from "@/types/preferences";
import type { TradeOffer, TradeOfferStatus } from "@/types/trade";

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
function isUuid(value: string): boolean {
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

export async function createSession(session: ServerSession): Promise<void> {
  await db
    .insert(sessions)
    .values({ token: session.token, userId: session.userId, expiresAt: new Date(session.expiresAt) });
}

export async function findSession(token: string): Promise<ServerSession | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(token);
    return null;
  }
  return { token: row.token, userId: row.userId, expiresAt: row.expiresAt.toISOString() };
}

/** Signs a pilot out everywhere — used after a password reset, so a session someone else may be holding can't outlive the credential that created it. */
export async function deleteSessionsForUser(userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
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

export async function listTradeOffers(): Promise<TradeOffer[]> {
  const rows = await db.select().from(tradeOffers).orderBy(desc(tradeOffers.createdAt));
  return rows.map(toTradeOffer);
}

export async function findTradeOffer(id: string): Promise<TradeOffer | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
  return row ? toTradeOffer(row) : null;
}

export async function createTradeOffer(offer: TradeOffer): Promise<void> {
  await db.insert(tradeOffers).values({
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

export async function listAwardHistoryRecords(filter: {
  base: string;
  aircraft: string;
  seat: string;
}): Promise<AwardHistoryRecord[]> {
  const rows = await db
    .select()
    .from(awardHistoryRecords)
    .where(
      and(
        eq(awardHistoryRecords.base, filter.base),
        eq(awardHistoryRecords.aircraft, filter.aircraft),
        eq(awardHistoryRecords.seat, filter.seat)
      )
    );
  return rows.map((row) => ({
    id: row.id,
    base: row.base,
    aircraft: row.aircraft,
    seat: row.seat as AwardHistoryRecord["seat"],
    month: row.month,
    seniorityRank: row.seniorityRank,
    seniorityTotalPilots: row.seniorityTotalPilots,
    outcome: row.outcome as AwardHistoryRecord["outcome"],
    lineNumber: row.lineNumber,
    daysOff: row.daysOff,
    totalCreditHours: row.totalCreditHours,
    totalTafbHours: row.totalTafbHours,
    submittedAt: row.submittedAt.toISOString(),
  }));
}

export async function createAwardHistoryRecord(record: AwardHistoryRecord): Promise<void> {
  await db.insert(awardHistoryRecords).values({
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
