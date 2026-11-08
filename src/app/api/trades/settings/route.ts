import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { saveTradeSettings } from "@/lib/server/db";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { lapseSuggestionsFor } from "@/lib/server/trade-suggestions";

export const runtime = "nodejs";

/** A signed-in pilot's trade settings: whether trades are suggested for them, and whether to email them about one. */
export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("trade-settings", user.id, 60, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, 1_000);
  if (!isJsonObject(body) || typeof body.suggestMe !== "boolean" || typeof body.emailMatches !== "boolean") {
    return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
  }
  try {
    await saveTradeSettings(user.id, { suggestMe: body.suggestMe, emailMatches: body.emailMatches });
    // Trades everyone has already agreed stand; ones still being asked about go.
    if (!body.suggestMe) await lapseSuggestionsFor(user.id, null, { onlyProposed: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    await reportProblem("trades", e, { action: "save settings" });
    return NextResponse.json({ error: "Couldn't save that just now." }, { status: 503 });
  }
}
