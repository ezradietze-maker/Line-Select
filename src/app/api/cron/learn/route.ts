import { NextResponse } from "next/server";
import { secretMatches } from "@/lib/server/secret";
import { sendDailySummary } from "@/lib/server/alerts";
import { runLearningCycle } from "@/lib/server/learning-runner";

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
  const summary = await runLearningCycle("schedule");
  // The morning email: yesterday's numbers and what this run did. Its arriving each day is the sign this run happens.
  await sendDailySummary(summary).catch((e) => console.error("[cron] daily summary not sent", e));
  // A step that failed shows as a failed run on Vercel's cron page, not a quiet success.
  const failed = Array.isArray(summary?.results) && (summary.results as { error?: unknown }[]).some((r) => r.error);
  return NextResponse.json(summary ?? { skipped: "a run is already in progress" }, { status: failed ? 500 : 200 });
}
