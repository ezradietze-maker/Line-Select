import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies committed migrations (`drizzle/`) to the PRODUCTION database.
 *
 * Production credentials live only in `.env.production.local` (git-ignored),
 * which you create once from the Vercel dashboard — never in `.env.local`,
 * which points at the safe dev branch. This script refuses to run unless the
 * target host matches `PRODUCTION_DB_HOST` (set in `.env.local`), so a stale or
 * wrong file can never make it silently migrate the dev copy while reporting
 * success. It only ever applies the committed, reviewed migration files, in
 * order, skipping ones already recorded — it runs no ad-hoc SQL.
 *
 * See docs/safe-database.md.
 */

// 1. The production-host marker lives in .env.local (next to the dev DATABASE_URL).
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the prodHost check below fails closed.
}
const prodHost = process.env.PRODUCTION_DB_HOST?.trim().toLowerCase();
if (!prodHost) {
  throw new Error(
    "PRODUCTION_DB_HOST is not set in .env.local, so the production target can't be verified. " +
      "Set it to your live Neon endpoint host — see docs/safe-database.md."
  );
}

// 2. Load the production credentials, clearing the dev DATABASE_URL first so it can't shadow them.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_URL_NON_POOLING;
try {
  process.loadEnvFile(".env.production.local");
} catch {
  throw new Error(
    "No .env.production.local found. Create it once with the production DATABASE_URL from the Vercel\n" +
      "dashboard (Project -> Settings -> Environment Variables -> DATABASE_URL, Production):\n" +
      "  echo 'DATABASE_URL=postgresql://…(production)…' > .env.production.local"
  );
}
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("No DATABASE_URL found in .env.production.local.");
}

// 3. Hard gate: the target MUST be the known production host. Neon's pooled and direct hosts
//    differ only by a "-pooler" suffix, so compare them with that stripped.
const stripPooler = (h: string) => h.replace(/-pooler(?=\.|$)/, "");
let host: string;
try {
  host = new URL(connectionString).hostname.toLowerCase();
} catch {
  throw new Error("The production DATABASE_URL in .env.production.local is not a valid URL.");
}
if (!stripPooler(host).includes(stripPooler(prodHost))) {
  throw new Error(
    `Refusing to run: target host "${host}" does not match PRODUCTION_DB_HOST "${prodHost}".\n` +
      "This script only ever migrates the production database."
  );
}

async function main() {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  console.log(`Applying migrations to PRODUCTION (${host})…`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Production migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
