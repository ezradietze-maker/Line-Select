import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { answerSuggestion } from "@/lib/server/trade-suggestions";
import { suggestionForViewer } from "@/lib/trades/suggestions";

export const runtime = "nodejs";

/** A pilot's yes or no to a suggested trade they're on. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("trade-matches-answer", user.id, 60, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, 200);
  const answer = isJsonObject(body) ? body.answer : null;
  if (answer !== "accepted" && answer !== "declined") return NextResponse.json({ error: "Accept or decline?" }, { status: 400 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "We couldn't find that trade." }, { status: 404 });
  try {
    const result = await answerSuggestion(id, user.id, answer);
    if (!result.ok) {
      return result.reason === "not-found"
        ? NextResponse.json({ error: "We couldn't find that trade." }, { status: 404 })
        : NextResponse.json({ error: "That trade is no longer open." }, { status: 409 });
    }
    return NextResponse.json({ suggestion: suggestionForViewer(result.record, user.id) });
  } catch (e) {
    await reportProblem("trades", e, { action: "answer" });
    return NextResponse.json({ error: "Couldn't save your answer just now." }, { status: 503 });
  }
}
