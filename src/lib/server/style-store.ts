import { sql } from "drizzle-orm";
import { db } from "@/lib/server/postgres";
import { interviewStyleSamples } from "@/lib/server/schema";

/**
 * The anonymized phrase corpus behind "use this data amongst other pilots'
 * interviews, not just one" — see `interviewStyleSamples` in `schema.ts`
 * for what's actually stored and why it carries no pilot link at all.
 * Global, not scoped to a bid pack: phrasing style doesn't depend on which
 * aircraft/base a pilot flies.
 */

const MAX_ROWS = 4000;

/**
 * Stores this pilot's scrubbed phrases (already stripped of anything
 * identifying by the extraction prompt — see `runBiddingStoryExtraction`).
 * Prunes the oldest rows past `MAX_ROWS` so the table can't grow forever;
 * a rolling sample of recent phrasing is exactly as useful as the full
 * history for calibration purposes.
 */
export async function saveStyleSamples(phrases: string[], tags: string[]): Promise<void> {
  const rows = phrases.filter((p) => p.trim().length > 0).slice(0, 5);
  if (rows.length === 0) return;

  await db.insert(interviewStyleSamples).values(rows.map((phrase) => ({ phrase, tags })));

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(interviewStyleSamples);
  const over = Number(count) - MAX_ROWS;
  if (over > 0) {
    await db.execute(sql`
      delete from interview_style_samples
      where id in (
        select id from interview_style_samples order by created_at asc limit ${over}
      )
    `);
  }
}

/** A random sample of up to `n` stored phrases — loose vocabulary/register calibration, never returned to a client, never quoted verbatim per the prompt's own instruction. Empty until the corpus has anything in it. */
export async function loadStyleSample(n: number): Promise<string[]> {
  const rows = await db
    .select({ phrase: interviewStyleSamples.phrase })
    .from(interviewStyleSamples)
    .orderBy(sql`random()`)
    .limit(n);
  return rows.map((r) => r.phrase);
}
