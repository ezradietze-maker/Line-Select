import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { isUuid } from "@/lib/server/db";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { markStepDone } from "@/lib/server/trade-suggestions";
import { suggestionForViewer } from "@/lib/trades/suggestions";

export const runtime = "nodejs";

/** A pilot on a trade says its next step went through in VIPS. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("trade-matches-step", user.id, 60, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, 200);
  const step = isJsonObject(body) ? body.step : null;
  if (!Number.isInteger(step)) return NextResponse.json({ error: "Which step?" }, { status: 400 });
  const { id } = await params;
  // The strict check, as in `answer`: a malformed id is not found, not a database error that emails the owner.
  if (!isUuid(id)) return NextResponse.json({ error: "We couldn't find that trade." }, { status: 404 });
  try {
    const result = await markStepDone(id, user.id, step as number);
    if (!result.ok) {
      if (result.reason === "not-found") return NextResponse.json({ error: "We couldn't find that trade." }, { status: 404 });
      if (result.reason === "not-yours") return NextResponse.json({ error: "That step is between two other pilots." }, { status: 403 });
      if (result.reason === "traded") return NextResponse.json({ error: "One of these trips is already in a trade agreed this month." }, { status: 409 });
      return NextResponse.json({ error: "That isn't the next step." }, { status: 409 });
    }
    return NextResponse.json({ suggestion: suggestionForViewer(result.record, user.id) });
  } catch (e) {
    await reportProblem("trades", e, { action: "mark step" });
    return NextResponse.json({ error: "Couldn't save that just now." }, { status: 503 });
  }
}
