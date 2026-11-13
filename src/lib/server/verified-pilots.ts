import { isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { hashUser } from "@/lib/server/pilot-hash";
import { db } from "@/lib/server/postgres";
import { users } from "@/lib/server/schema";
import type { UserAccount } from "@/types/auth";

/**
 * Who counts as a pilot. An account costs nothing to make, so every "enough different pilots" guard (group award
 * numbers, "Held by", shared forecast rankings, the Trade Board's bar, the pack a group is matched on, the fleet
 * learning) would fall to a handful of made-up ones. Only accounts whose address was confirmed count, share or trade.
 * An unconfirmed one still uses the app for itself.
 */

export function isVerified(user: Pick<UserAccount, "emailVerified"> | null | undefined): boolean {
  return user?.emailVerified === true;
}

/**
 * The answer to a signed-in pilot whose address isn't confirmed yet, trying something only confirmed pilots may do.
 * `confirmEmail` is what tells the app to show its "Confirm your email" button beside the words.
 */
export function confirmEmailRefusal(toDo: string): NextResponse {
  return NextResponse.json({ error: `Confirm your email to ${toDo}. It's how we know each account is a real pilot.`, confirmEmail: true }, { status: 403 });
}

/** The confirmed accounts' ids, as a subquery: `inArray(table.userId, verifiedUserIds())`. */
export function verifiedUserIds() {
  return db.select({ id: users.id }).from(users).where(isNotNull(users.emailVerifiedAt));
}

/**
 * The one-way tags (`hashUser`) of every confirmed account, for the shared tables kept by tag rather than account.
 * The tags can't be turned back into accounts, so they're worked out from the accounts instead. Kept for half a
 * minute: a forecast asks on every ranking change, and a pilot confirmed a moment ago only waits that long to count.
 */
const CACHE_MS = 30_000;
let cache: { at: number; hashes: Set<string> } | null = null;

export async function verifiedPilotHashes(now = Date.now()): Promise<Set<string>> {
  if (cache && now - cache.at < CACHE_MS) return cache.hashes;
  const rows = await verifiedUserIds();
  cache = { at: now, hashes: new Set(rows.map((r) => hashUser(r.id))) };
  return cache.hashes;
}

/** After a confirm on this server, so it counts here at once. */
export function forgetVerifiedPilots(): void {
  cache = null;
}

/** Only the rows from confirmed accounts. A row with no tag can't be traced to any account, so it doesn't count either. */
export function fromVerified<T>(rows: T[], verified: ReadonlySet<string>, tagOf: (row: T) => string | null): T[] {
  return rows.filter((r) => {
    const tag = tagOf(r);
    return tag !== null && verified.has(tag);
  });
}
