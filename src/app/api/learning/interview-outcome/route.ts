import { NextResponse } from "next/server";
import { parseInterviewOutcome } from "@/lib/learning/validate";
import { afterResponse } from "@/lib/server/after-response";
import { getCurrentServerUser } from "@/lib/server/auth";
import { hashUser } from "@/lib/server/forecast-store";
import { maybeLearn } from "@/lib/server/learning-runner";
import { saveInterviewOutcome } from "@/lib/server/learning-store";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Receives the anonymous summary of one finished interview (see
 * `InterviewOutcome` — counts and where answers landed, never a pilot's
 * words) and, once enough have come in since the last learning run, learns
 * from them right away rather than waiting for the daily run.
 */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("interview-outcome", clientIp(request), 10, 60 * 60);
  if (!ok) return rateLimitedResponse();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const outcome = parseInterviewOutcome(raw);
  if (!outcome) return NextResponse.json({ error: "Invalid interview summary." }, { status: 400 });

  const user = await getCurrentServerUser();
  try {
    await saveInterviewOutcome(outcome, user ? hashUser(user.id) : null);
  } catch (e) {
    console.error("[learning] interview outcome not saved", e);
    return NextResponse.json({ stored: false }, { status: 503 });
  }
  afterResponse(() => maybeLearn("interviews"));
  return NextResponse.json({ stored: true });
}
