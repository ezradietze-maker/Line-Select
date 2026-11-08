import { and, count, eq } from "drizzle-orm";
import { decodeRanking, encodeRanking } from "@/lib/forecast/ranking-codec";
import type { KnownRanking } from "@/lib/forecast/simulate";
import { hashUser } from "@/lib/server/pilot-hash";
import { db } from "@/lib/server/postgres";
import { forecastRankings } from "@/lib/server/schema";

/**
 * The rankings pilots have shared, per seat and month — what lets the forecast
 * stop guessing about the pilots ahead of you. Nothing here is ever returned to
 * a client: the server reads it to run the forecast and sends back only
 * probabilities, so no pilot can look up what another one wants. A pilot is
 * stored under a one-way hash of their account id, and by their place in bid
 * order (a number from the bid pack's own list), never a name.
 *
 * Backed by the `forecast_rankings` table (see `schema.ts`) rather than a
 * per-pack JSON blob — claiming a bid position is one atomic upsert guarded
 * by a unique `(blobKey, bidNumber)` constraint, not a read-then-check-then-
 * write race.
 */

const MAX_ENTRIES = 4000;

export function blobKey(packKey: string, lineNumbers: string[]): string {
  return `line-select:forecast:${packKey}:${lineNumbers.length}:${lineNumbers[0] ?? ""}-${lineNumbers[lineNumbers.length - 1] ?? ""}`;
}

export { hashUser };

/** Everyone's shared rankings for this pack except the asking pilot's own, as line indices. */
export async function loadKnownRankings(
  packKey: string,
  lineNumbers: string[],
  excludeUserId: string | null
): Promise<{ known: KnownRanking[]; total: number }> {
  const key = blobKey(packKey, lineNumbers);
  const me = excludeUserId ? hashUser(excludeUserId) : null;
  const all = await db.select().from(forecastRankings).where(eq(forecastRankings.blobKey, key));
  const others = me ? all.filter((row) => row.userHash !== me) : all;
  return {
    known: others.map((row) => ({ bidNumber: row.bidNumber, ranking: decodeRanking(row.ranking, lineNumbers.length) })),
    total: all.length,
  };
}

export type SaveResult = { stored: true } | { stored: false; reason: "position-taken" | "store-full" };

/**
 * Saves (or replaces) a pilot's shared ranking. One pilot per bid position:
 * a different account can't take over a position that's already claimed —
 * enforced by the unique `(blobKey, bidNumber)` index via a conditional
 * upsert (`ON CONFLICT ... WHERE forecast_rankings.user_hash = excluded.user_hash`),
 * which only ever touches a row that either doesn't exist yet or already
 * belongs to this same pilot. Zero rows affected means someone else holds
 * that position — genuinely atomic, not a read-then-write guess.
 */
export async function saveSubmission(params: {
  packKey: string;
  lineNumbers: string[];
  userId: string;
  bidNumber: number;
  seniority: number;
  ranking: number[];
}): Promise<SaveResult> {
  const key = blobKey(params.packKey, params.lineNumbers);
  const user = hashUser(params.userId);
  const ranking = encodeRanking(params.ranking, params.lineNumbers.length);

  try {
    return await saveInTransaction(key, user, ranking, params);
  } catch (e) {
    if (e instanceof PositionTaken) return { stored: false, reason: "position-taken" };
    throw e;
  }
}

/** Thrown to undo the transaction: a moved pilot whose new place was taken in the meantime keeps their old row. */
class PositionTaken extends Error {}

function saveInTransaction(key: string, user: string, ranking: string, params: { bidNumber: number; seniority: number }): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    let moved = false;
    const [existingMine] = await tx
      .select({ bidNumber: forecastRankings.bidNumber })
      .from(forecastRankings)
      .where(and(eq(forecastRankings.blobKey, key), eq(forecastRankings.userHash, user)))
      .limit(1);

    if (!existingMine) {
      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(forecastRankings)
        .where(eq(forecastRankings.blobKey, key));
      if (Number(total) >= MAX_ENTRIES) return { stored: false, reason: "store-full" };
    } else if (existingMine.bidNumber !== params.bidNumber) {
      // A moved bid number: the old row goes first, or the insert below breaks the one-row-per-pilot index — which
      // its conflict target (the bid number) doesn't cover — and the share fails outright. Not if the new place is taken.
      const [holder] = await tx
        .select({ userHash: forecastRankings.userHash })
        .from(forecastRankings)
        .where(and(eq(forecastRankings.blobKey, key), eq(forecastRankings.bidNumber, params.bidNumber)))
        .limit(1);
      if (holder && holder.userHash !== user) return { stored: false, reason: "position-taken" };
      await tx.delete(forecastRankings).where(and(eq(forecastRankings.blobKey, key), eq(forecastRankings.userHash, user)));
      moved = true;
    }

    const [claimed] = await tx
      .insert(forecastRankings)
      .values({ blobKey: key, userHash: user, bidNumber: params.bidNumber, seniority: params.seniority, ranking })
      .onConflictDoUpdate({
        target: [forecastRankings.blobKey, forecastRankings.bidNumber],
        set: { seniority: params.seniority, ranking, updatedAt: new Date() },
        setWhere: eq(forecastRankings.userHash, user),
      })
      .returning({ userHash: forecastRankings.userHash, bidNumber: forecastRankings.bidNumber });

    if (!claimed || claimed.userHash !== user) {
      // Another pilot took the new place after the check above: their old row's delete is rolled back with the rest.
      if (moved) throw new PositionTaken();
      return { stored: false, reason: "position-taken" };
    }

    return { stored: true };
  });
}

/** Removes a pilot's shared ranking (when they clear their data). */
export async function removeSubmission(packKey: string, lineNumbers: string[], userId: string): Promise<void> {
  const key = blobKey(packKey, lineNumbers);
  const user = hashUser(userId);
  await db.delete(forecastRankings).where(and(eq(forecastRankings.blobKey, key), eq(forecastRankings.userHash, user)));
}
