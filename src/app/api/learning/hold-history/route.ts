import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { summarizeHoldHistory } from "@/lib/learning/hold-history";
import { getCurrentServerUser } from "@/lib/server/auth";
import { hashUser } from "@/lib/server/forecast-store";
import { listPilotHoldRecords } from "@/lib/server/learning-store";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** A signed-in pilot's own record of what they've held, month after month — only ever their own. */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your history." }, { status: 401 });
  if (!(await checkRateLimit("hold-history", user.id, 120, 60 * 60)).ok) return rateLimitedResponse();
  try {
    return NextResponse.json({ history: summarizeHoldHistory(await listPilotHoldRecords(hashUser(user.id))) });
  } catch (e) {
    await reportProblem("learning", e, { action: "hold history" });
    return NextResponse.json({ history: null }, { status: 503 });
  }
}
