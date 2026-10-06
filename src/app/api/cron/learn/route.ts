import { NextResponse } from "next/server";
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
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const summary = await runLearningCycle("schedule");
  return NextResponse.json(summary ?? { skipped: "a run is already in progress" });
}
