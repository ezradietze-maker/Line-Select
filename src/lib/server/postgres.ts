import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/server/schema";

/**
 * A module-level singleton pool, kept warm across invocations on the same
 * warm serverless instance — same spirit as `kv.ts`'s singleton Redis
 * client. Every API route runs on the Node.js runtime (checked across the
 * whole app), so a normal pooled TCP connection is safe here; point this at
 * Neon's pooled connection string (or any Postgres) via `DATABASE_URL` /
 * `POSTGRES_URL`, whichever the hosting integration injects.
 *
 * Connection is deliberately lazy (built on first query, not on import) so
 * that importing this module — or anything that imports it — never fails
 * just because no database is configured yet; a test file with no
 * `DATABASE_URL` can still import `db.ts` and skip its own suite cleanly
 * instead of crashing every other test file that happens to share a module
 * graph with it.
 */
type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (instance) return instance;
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "No Postgres connection string found — set DATABASE_URL (or POSTGRES_URL) in .env.local. " +
        "See HANDOFF.md for how this project's database is provisioned."
    );
  }
  const pool = new Pool({ connectionString, max: 10 });
  instance = drizzle(pool, { schema });
  return instance;
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
