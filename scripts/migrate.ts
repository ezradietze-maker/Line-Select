import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// A standalone script, unlike `next dev`/`next build`, doesn't auto-load
// .env.local — load it explicitly (harmless if it's absent, e.g. in an
// environment where these vars are already injected).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

/**
 * Applies committed SQL migrations (`drizzle/`) to whatever Postgres
 * `DATABASE_URL` points at. Prefers a non-pooled connection string when one
 * is set — some poolers (e.g. PgBouncer in transaction mode) don't like the
 * advisory locks/DDL a migration run uses.
 */
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error("No Postgres connection string found — set DATABASE_URL in .env.local first.");
}

async function main() {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
