import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/server/schema";
import { assertLocalRuntimeNotProduction } from "@/lib/server/db-guard";

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

/**
 * The pool, made safe for a dropped network. A pooled client's socket can fail
 * while no query is running on it (Neon idles out, Wi-Fi drops): pg then emits
 * `error` on the client, and pg-pool re-emits it on the pool. An EventEmitter
 * `error` with no listener is thrown as an uncaught exception, which took the
 * dev server down on Nov 13 (`read ETIMEDOUT`) and would kill a serverless
 * function. So the pool and every client it makes get a listener that only
 * logs: pg-pool has already dropped an idle client by then, and a checked-out
 * one is dropped on release because it's no longer queryable. A query that's
 * running when the socket fails is unaffected: its promise rejects with the
 * error, and the route returns its own error response as for any other failure.
 *
 * keepAlive finds a dead socket instead of waiting on it forever; the timeouts
 * stop a request hanging on an unreachable database and let idle connections go
 * before Neon closes them from its side.
 */
export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("connect", (client) =>
    client.on("error", (err) => console.error("[postgres] connection dropped; the pool will open a new one:", err.message))
  );
  // The client's own listener above has already logged it.
  pool.on("error", () => {});
  return pool;
}

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
  // A local process (dev server, a script that imports this module) must not
  // open the app's pool against the live database. No-op on Vercel.
  assertLocalRuntimeNotProduction(connectionString);
  const pool = createPool(connectionString);
  instance = drizzle(pool, { schema });
  return instance;
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
