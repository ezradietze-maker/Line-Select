import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PgSession } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import journal from "../drizzle/meta/_journal.json";

/**
 * `npm run db:migrate` runs drizzle's own Postgres migrator, which keeps no list of what it has applied by name: it
 * reads the newest `created_at` it has recorded and runs every journal entry whose `when` is later. So a `when` that
 * isn't later than the one before it is silently skipped on any database that already has the earlier one. These run
 * the real migrator over the real `drizzle/` folder against a pretend database, so no Postgres is needed.
 */

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const tags = journal.entries.map((e) => e.tag);
const whenOf = (tag: string) => journal.entries.find((e) => e.tag === tag)!.when;

/** Runs the migrator on a database whose recorded migrations are `applied`; returns the tags it ran, in order. */
async function migrateFrom(applied: string[]): Promise<string[]> {
  const dialect = new PgDialect();
  const ran: string[] = [];
  const latest = Math.max(0, ...applied.map(whenOf));
  const session = {
    execute: async () => [],
    all: async () => (applied.length ? [{ id: 1, hash: "h", created_at: String(latest) }] : []),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        execute: async (query: SQL) => {
          const { sql, params } = dialect.sqlToQuery(query);
          // The row the migrator records after each migration: its params are [hash, when].
          if (/insert into "drizzle"\."__drizzle_migrations"/.test(sql)) ran.push(journal.entries.find((e) => e.when === params[1])!.tag);
        },
      }),
  } as unknown as PgSession;
  await dialect.migrate(migrations, session, { migrationsFolder: "./drizzle" });
  return ran;
}

describe("drizzle migrations", () => {
  it("are dated in the order they're listed, so the migrator never passes one over", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].when, journal.entries[i].tag).toBeGreaterThan(journal.entries[i - 1].when);
    }
  });

  it("a database that has everything up to 0012 gets 0013 and 0014", async () => {
    expect(await migrateFrom(tags.slice(0, 13))).toEqual(["0013_acoustic_arclight", "0014_nostalgic_shriek"]);
  });

  it("a fresh database gets every migration, in order", async () => {
    expect(await migrateFrom([])).toEqual(tags);
  });

  it("the live database (0000–0014 recorded) runs nothing", async () => {
    expect(await migrateFrom(tags)).toEqual([]);
  });

  it("0013 can run again on a database that already has the subscriptions table", () => {
    // A database migrated while 0013 was dated before 0011 ran it ahead of 0011 and 0012, so its newest record is
    // 0012's and the migrator now hands it 0013 a second time. That second run must change nothing and not fail.
    const sql = migrations[tags.indexOf("0013_acoustic_arclight")].sql.join("\n");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "subscriptions"/);
    expect(sql).toMatch(/EXCEPTION\s+WHEN duplicate_object THEN null/);
  });
});
