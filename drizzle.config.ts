import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` needs the schema file and works with no live
// connection; `db:migrate` (scripts/migrate.ts) is what actually connects,
// so a missing connection string here is fine until a database exists.
const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

export default defineConfig({
  schema: "./src/lib/server/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
