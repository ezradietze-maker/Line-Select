import { NextResponse } from "next/server";
import { secretMatches } from "@/lib/server/secret";
import { reportProblem, sendDailySummary } from "@/lib/server/alerts";
import { UNCONFIRMED_SIGN_UP_DAYS } from "@/lib/server/auth";
import { deleteUnconfirmedSignUps } from "@/lib/server/db";
import { incrementCounter } from "@/lib/server/kv";
import { runLearningCycle } from "@/lib/server/learning-runner";
import { DAILY_MATCHING_BUDGET_MS, runDailyMatching, tradeSummaryText } from "@/lib/server/trade-matching";
import { weeklySection } from "@/lib/server/weekly-summary";

export const runtime = "nodejs";
export const maxDuration = 300;
/** Kept back from the trades for the morning email and the clear-out of unconfirmed sign-ups. */
const AFTER_TRADES_MS = 30_000;

/**
 * The daily learning run (scheduled in vercel.json). Vercel signs scheduled
 * calls with `Authorization: Bearer $CRON_SECRET`; anything else is turned
 * away, so the run can't be triggered from outside.
 */
export async function GET(request: Request) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  // Only the live site runs it. A preview (every pushed branch gets one) shares the secret when it's set for every
  // environment, and may share the live database: called there, it ran that branch's learning and trade matching on
  // real pilots and sent a second morning email. Vercel never schedules a preview's crons; this keeps anyone else off.
  const preview = !!process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production";
  if (preview || !secret || !secretMatches(request.headers.get("authorization"), `Bearer ${secret}`)) {
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
  // Trades come after the learning, so a slow run of either can't stop the morning email: this one never throws, and has
  // its own time limit, cut to what a slow learning run left of the five minutes.
  const tradesBudget = Math.max(0, Math.min(DAILY_MATCHING_BUDGET_MS, maxDuration * 1000 - AFTER_TRADES_MS - (Date.now() - started)));
  const matched = await runDailyMatching(now, tradesBudget);
  const trades = { text: await tradeSummaryText(matched, now), failed: matched.failed > 0 };
  await sendDailySummary(summary, now, weekly, trades).catch((e) => console.error("[cron] daily summary not sent", e));
  const removedUnconfirmed = await removeUnconfirmedSignUps(now);
  // A step that failed shows as a failed run on Vercel's cron page, not a quiet success.
  const failed = Array.isArray(summary?.results) && (summary.results as { error?: unknown }[]).some((r) => r.error);
  return NextResponse.json({ ...(summary ?? { skipped: "a run is already in progress" }), removedUnconfirmed }, { status: failed ? 500 : 200 });
}

/**
 * Accounts made by signing up and not confirmed within the week the confirm email gives them: whoever made them never
 * showed the address was theirs, and the address's owner may want it. Never throws; null when it couldn't run.
 */
async function removeUnconfirmedSignUps(now: Date): Promise<number | null> {
  try {
    const removed = await deleteUnconfirmedSignUps(new Date(now.getTime() - UNCONFIRMED_SIGN_UP_DAYS * 24 * 60 * 60 * 1000));
    if (removed) console.log("[cron] removed unconfirmed sign-ups", { removed });
    return removed;
  } catch (e) {
    await reportProblem("accounts", e, { action: "remove unconfirmed sign-ups" });
    return null;
  }
}
