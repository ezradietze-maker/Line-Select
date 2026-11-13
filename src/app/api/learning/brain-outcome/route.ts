import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { parseBrainOutcome } from "@/lib/learning/brain-learning";
import { afterResponse } from "@/lib/server/after-response";
import { getCurrentServerUser } from "@/lib/server/auth";
import { isVerified } from "@/lib/server/verified-pilots";
import { hashUser } from "@/lib/server/forecast-store";
import { maybeLearn } from "@/lib/server/learning-runner";
import { saveBrainOutcome } from "@/lib/server/learning-store";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Receives the anonymous outcome of one story-driven interview (see
 * `BrainOutcome` — the shape of the pilot's finished model, their city grades
 * and review verdicts; never their words) and learns from it once enough
 * have come in since the last run.
 */
export async function POST(request: Request) {
  const { ok } = await checkRequestLimit("brain-outcome", request, 10, 60 * 60);
  if (!ok) return rateLimitedResponse();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const outcome = parseBrainOutcome(raw);
  if (!outcome) return NextResponse.json({ error: "Invalid interview summary." }, { status: 400 });
  // Only signed-in pilots teach the fleet: each counts once, and nobody can stand in for a group of pilots who aren't there.
  // Confirmed accounts only, for the same reason: an unconfirmed one may be one of many made up by one person.
  const user = await getCurrentServerUser();
  if (!user || !isVerified(user)) return NextResponse.json({ stored: false });
  try {
    await saveBrainOutcome(outcome, hashUser(user.id));
  } catch (e) {
    await reportProblem("learning", e, { action: "save brain outcome" });
    return NextResponse.json({ stored: false }, { status: 503 });
  }
  afterResponse(() => maybeLearn("interviews"));
  return NextResponse.json({ stored: true });
}
