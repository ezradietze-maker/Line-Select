import { Pool } from "pg";
import { keyedPilotHash, PILOT_HASH_COLUMNS, plainPilotHash } from "../src/lib/server/pilot-hash";
import { assertSafeForDestructiveOp } from "../src/lib/server/db-guard";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

/**
 * One-off: moves every stored pilot hash from the plain hash to the keyed one (`src/lib/server/pilot-hash.ts`), in one
 * transaction. Safe to run again: a row already moved no longer matches anything. Rows from accounts since deleted keep
 * their old hash, which nothing links to any more.
 *
 *   PILOT_HASH_SECRET=… npx tsx scripts/rehash-pilot-hashes.ts            counts what would move
 *   PILOT_HASH_SECRET=… npx tsx scripts/rehash-pilot-hashes.ts --apply    moves it
 *
 * Run it right after a deploy that has PILOT_HASH_SECRET set, with that same value. Prints counts only.
 */
async function main() {
  const secret = process.env.PILOT_HASH_SECRET;
  if (!secret) throw new Error("Set PILOT_HASH_SECRET to the value the live site uses.");
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("No Postgres connection string found.");
  const apply = process.argv.includes("--apply");
  // The --apply run updates every stored pilot hash. Only guard the real write:
  // a dry run rolls back, but the guard makes the intent explicit either way.
  if (apply) assertSafeForDestructiveOp(connectionString, "rehash-pilot-hashes --apply");
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>("select id from users");
    const plain = rows.map((u) => plainPilotHash(u.id));
    const keyed = rows.map((u) => keyedPilotHash(u.id, secret));
    await client.query("begin");
    for (const { table, column } of PILOT_HASH_COLUMNS) {
      const sql = `update ${table} t set ${column} = m.keyed from unnest($1::text[], $2::text[]) as m(plain, keyed) where t.${column} = m.plain`;
      const result = await client.query(sql, [plain, keyed]);
      console.log(`${table}.${column}: ${result.rowCount ?? 0} row(s)`);
    }
    await client.query(apply ? "commit" : "rollback");
    console.log(apply ? "Moved." : "Nothing changed. Run with --apply to move them.");
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
