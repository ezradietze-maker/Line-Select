import { createHash, createHmac } from "node:crypto";

/**
 * The one-way tag a pilot's shared data is kept under. Keyed with a server secret, because a plain hash of the account
 * id can be undone by anyone holding a copy of the database: the users table sits beside it, so they could hash every
 * id and match. With the key, a stolen copy alone can't link a shared row to an account.
 */
const PREFIX = "line-select-forecast:";

/** The hash from before the key. Only for tests' expectations and the one-off move in `scripts/rehash-pilot-hashes.ts`. */
export function plainPilotHash(userId: string): string {
  return createHash("sha256").update(`${PREFIX}${userId}`).digest("hex").slice(0, 20);
}

export function keyedPilotHash(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}${userId}`).digest("hex").slice(0, 20);
}

/** Whether this server has the key. Local development and tests run without it; `/api/admin/calibration` reports it for the live site. */
export function pilotHashIsKeyed(): boolean {
  return !!process.env.PILOT_HASH_SECRET;
}

export function hashUser(userId: string): string {
  const secret = process.env.PILOT_HASH_SECRET;
  return secret ? keyedPilotHash(userId, secret) : plainPilotHash(userId);
}

/** Every table and column that holds this hash. A new one must be added here, or the move would leave its rows behind. */
export const PILOT_HASH_COLUMNS = [
  { table: "award_history_records", column: "pilot_hash" },
  { table: "forecast_predictions", column: "pilot_hash" },
  { table: "forecast_rankings", column: "user_hash" },
  { table: "interview_outcomes", column: "pilot_hash" },
  { table: "preference_corrections", column: "pilot_hash" },
] as const;
