import { Pool } from "pg";
import { assertSafeForDestructiveOp } from "../src/lib/server/db-guard";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

/**
 * One-off: clears the session rows from before tokens were stored as hashes (deployed 6 Nov 2026), and any session
 * already past its expiry, in one transaction.
 *
 * Why it deletes them rather than hashing them: a token is 64 hex characters and so is its SHA-256, so a row's value
 * can't say whether it's a token never rewritten or one already rewritten as its hash. Hashing every old row would
 * hash the rewritten ones a second time, and a row holding the hash of a hash works as a cookie for anyone who has the
 * first hash: the hole this is closing. Since the lookup by the raw value was removed, the rows never rewritten can't
 * be used anyway; this clears them, and the rewritten ones from the same days with them. Pilots signed in since before
 * 6 Nov (and only they) sign in once more. Every one of these rows expires by 6 Dec 2026 on its own, so after that this
 * has nothing left to do.
 *
 *   npx tsx scripts/purge-legacy-sessions.ts            counts what would go
 *   npx tsx scripts/purge-legacy-sessions.ts --apply    deletes it
 *
 * Prints counts only.
 */

/** Every row written before hashing began expires by this moment; every row written after, later. */
const LEGACY_SESSIONS_EXPIRE_BY = "2026-12-06T19:20:00Z";

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("No Postgres connection string found.");
  const apply = process.argv.includes("--apply");
  // The --apply run deletes session rows. Guard the real delete; the dry run
  // only counts and rolls back. See docs/safe-database.md.
  if (apply) assertSafeForDestructiveOp(connectionString, "purge-legacy-sessions --apply");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const legacy = await client.query("delete from sessions where expires_at <= $1", [LEGACY_SESSIONS_EXPIRE_BY]);
    const expired = await client.query("delete from sessions where expires_at < now()");
    console.log(`from before hashing: ${legacy.rowCount ?? 0} row(s)`);
    console.log(`otherwise expired: ${expired.rowCount ?? 0} row(s)`);
    await client.query(apply ? "commit" : "rollback");
    console.log(apply ? "Deleted." : "Nothing changed. Run with --apply to delete them.");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
