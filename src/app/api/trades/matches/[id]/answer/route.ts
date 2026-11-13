import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { confirmEmailRefusal, isVerified } from "@/lib/server/verified-pilots";
import { isUuid } from "@/lib/server/db";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { answerSuggestion } from "@/lib/server/trade-suggestions";
import { suggestionForViewer } from "@/lib/trades/suggestions";
import type { TradeDeclineReason } from "@/types/trade";

export const runtime = "nodejs";

const REASONS = new Set<string>(["trip", "notWorthIt", "notNow", "wrongHolding"] satisfies TradeDeclineReason[]);

/** A pilot's yes or no to a suggested trade they're on. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("trade-matches-answer", user.id, 60, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, 300);
  const answer = isJsonObject(body) ? body.answer : null;
  if (answer !== "accepted" && answer !== "declined") return NextResponse.json({ error: "Accept or decline?" }, { status: 400 });
  // Saying no is always open: it only takes the pilot off a trade.
  if (answer === "accepted" && !isVerified(user)) return confirmEmailRefusal("say yes to a trade");
  const reason = isJsonObject(body) ? (body.reason ?? null) : null;
  if (reason !== null && !REASONS.has(reason as string)) return NextResponse.json({ error: "Invalid reason." }, { status: 400 });
  const { id } = await params;
  // The strict check: a loose one let "----…" through to Postgres, which threw, and each throw emailed the owner.
  if (!isUuid(id)) return NextResponse.json({ error: "We couldn't find that trade." }, { status: 404 });
  try {
    const result = await answerSuggestion(id, user.id, answer, new Date(), reason as TradeDeclineReason | null);
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
