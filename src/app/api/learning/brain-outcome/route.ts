import { NextResponse } from "next/server";
import { parseBrainOutcome } from "@/lib/learning/brain-learning";
import { afterResponse } from "@/lib/server/after-response";
import { getCurrentServerUser } from "@/lib/server/auth";
import { hashUser } from "@/lib/server/forecast-store";
import { maybeLearn } from "@/lib/server/learning-runner";
import { saveBrainOutcome } from "@/lib/server/learning-store";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Receives the anonymous outcome of one story-driven interview (see
 * `BrainOutcome` — the shape of the pilot's finished model, their city grades
 * and review verdicts; never their words) and learns from it once enough
 * have come in since the last run.
 */
export async function POST(request: Request) {
  const { ok } = await checkRateLimit("brain-outcome", clientIp(request), 10, 60 * 60);
  if (!ok) return rateLimitedResponse();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const outcome = parseBrainOutcome(raw);
  if (!outcome) return NextResponse.json({ error: "Invalid interview summary." }, { status: 400 });
  const user = await getCurrentServerUser();
  try {
    await saveBrainOutcome(outcome, user ? hashUser(user.id) : null);
  } catch (e) {
    console.error("[learning] brain outcome not saved", e);
    return NextResponse.json({ stored: false }, { status: 503 });
  }
  afterResponse(() => maybeLearn("interviews"));
  return NextResponse.json({ stored: true });
}
