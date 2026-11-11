import { NextResponse } from "next/server";
import { secretMatches } from "@/lib/server/secret";
import { sendDailySummary } from "@/lib/server/alerts";
import { incrementCounter } from "@/lib/server/kv";
import { runLearningCycle } from "@/lib/server/learning-runner";
import { runDailyMatching, tradeSummaryText } from "@/lib/server/trade-matching";
import { weeklySection } from "@/lib/server/weekly-summary";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The daily learning run (scheduled in vercel.json). Vercel signs scheduled
 * calls with `Authorization: Bearer $CRON_SECRET`; anything else is turned
 * away, so the run can't be triggered from outside.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // A call delivered twice runs once: only the learning had a lock, so trades ran again and the email went twice. Held
  // for a quarter of an hour, not the day, so the owner can still run it again by hand later.
  const day = new Date().toISOString().slice(0, 10);
  if ((await incrementCounter(`line-select:cron-learn:${day}`, 15 * 60)) > 1) return NextResponse.json({ skipped: "this run is already under way" });
  const summary = await runLearningCycle("schedule");
  // The morning email: yesterday's numbers and what this run did. Its arriving each day is the sign this run happens.
  // Mondays (UTC) it also carries the week: what the brain learned and whether it's helping.
  const now = new Date();
  const weekly = now.getUTCDay() === 1 ? await weeklySection(now) : null;
  // Trades come after the learning, so a slow run of either can't stop the morning email: this one has its own time limit and never throws.
  const trades = await tradeSummaryText(await runDailyMatching(now), now);
  await sendDailySummary(summary, now, weekly, trades).catch((e) => console.error("[cron] daily summary not sent", e));
  // A step that failed shows as a failed run on Vercel's cron page, not a quiet success.
  const failed = Array.isArray(summary?.results) && (summary.results as { error?: unknown }[]).some((r) => r.error);
  return NextResponse.json(summary ?? { skipped: "a run is already in progress" }, { status: failed ? 500 : 200 });
}
