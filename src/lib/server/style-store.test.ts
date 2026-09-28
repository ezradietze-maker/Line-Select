import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { loadStyleSample, saveStyleSamples } from "@/lib/server/style-store";
import { db } from "@/lib/server/postgres";
import { interviewStyleSamples } from "@/lib/server/schema";

/**
 * Integration test against a real Postgres — same pattern as `db.test.ts`
 * (skips cleanly with no DATABASE_URL). Uses a distinctive marker phrase so
 * cleanup can find and remove exactly the rows this test created, without
 * touching anything real accumulating in the corpus alongside it.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

const hasDb = !!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
if (!hasDb) {
  console.warn("Skipping style-store.test.ts — no DATABASE_URL set.");
}

const MARKER = "style-store-test-marker";

describe.skipIf(!hasDb)("interview style corpus", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.delete(interviewStyleSamples).where(inArray(interviewStyleSamples.id, createdIds));
    }
  });

  async function trackAllWithMarker() {
    const rows = await db
      .select({ id: interviewStyleSamples.id, phrase: interviewStyleSamples.phrase })
      .from(interviewStyleSamples);
    for (const row of rows) {
      if (row.phrase.includes(MARKER)) createdIds.push(row.id);
    }
  }

  it("stores and later samples a saved phrase, with no pilot link at all", async () => {
    const phrase = `${MARKER}-terse-and-dry`;
    await saveStyleSamples([phrase], ["terse", "dry humor"]);
    await trackAllWithMarker();

    const sample = await loadStyleSample(500);
    expect(sample).toContain(phrase);
  });

  it("caps how many phrases one submission can add (at most 5)", async () => {
    const phrases = Array.from({ length: 8 }, (_, i) => `${MARKER}-cap-check-${i}`);
    await saveStyleSamples(phrases, ["formal"]);
    await trackAllWithMarker();

    const sample = await loadStyleSample(1000);
    const stored = phrases.filter((p) => sample.includes(p));
    expect(stored.length).toBeLessThanOrEqual(5);
  });

  it("ignores an empty phrase list without writing anything", async () => {
    const before = await db.select({ id: interviewStyleSamples.id }).from(interviewStyleSamples);
    await saveStyleSamples([], ["tag-with-no-phrases"]);
    const after = await db.select({ id: interviewStyleSamples.id }).from(interviewStyleSamples);
    expect(after.length).toBe(before.length);
  });
});
