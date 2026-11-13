import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { proFeatureRefusal } from "@/lib/server/gating";
import { confirmEmailRefusal, isVerified } from "@/lib/server/verified-pilots";
import { getPreferenceProfile, getTradeHolding, getTradeSettings } from "@/lib/server/db";
import { isJsonObject, isText, readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { runMatching } from "@/lib/server/trade-matching";
import { listMatchingGroup, listSuggestionsFor } from "@/lib/server/trade-suggestions";
import { suggestionForViewer } from "@/lib/trades/suggestions";

export const runtime = "nodejs";
export const maxDuration = 90;

/** Reads of suggested trades one pilot may make in an hour (see GET). */
export const MATCHES_READ_LIMIT = 2_700;

/** The trades suggested to this pilot on one pack. Only ever their own view of them (`suggestionForViewer`). */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see suggested trades." }, { status: 401 });
  // Each open window asks every 10 seconds for its Inbox badge (360 an hour) and, on the Trade Board, every 20 for the
  // trades themselves (180): enough here for five windows. 900 was used up by two, and their trades stopped updating.
  if (!(await checkRateLimit("trade-matches-read", user.id, MATCHES_READ_LIMIT, 60 * 60)).ok) return rateLimitedResponse();
  const url = new URL(request.url);
  const pack = url.searchParams.get("pack")?.slice(0, 200);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  try {
    const suggestions = (await listSuggestionsFor(user.id, pack)).flatMap((s) => suggestionForViewer(s, user.id) ?? []);
    const waiting = suggestions.filter((s) => s.status === "proposed" && s.you.answer === "waiting").length;
    if (url.searchParams.has("waiting")) return NextResponse.json({ waiting }, { headers: { "Cache-Control": "private, no-store" } });
    const [holding, settings, profile] = await Promise.all([getTradeHolding(user.id, pack), getTradeSettings(user.id), getPreferenceProfile(user.id)]);
    const confirmedPilots = holding ? (await listMatchingGroup(holding.bidPackMeta)).rows.filter((r) => r.settings.suggestMe && r.profile?.pilotModel).length : 0;
    return NextResponse.json(
      { suggestions, waiting, confirmedPilots, ready: { holding: !!holding, suggestMe: settings.suggestMe, interview: !!profile?.pilotModel } },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e) {
    await reportProblem("trades", e, { action: "list suggestions" });
    return NextResponse.json({ error: "Couldn't load suggested trades just now." }, { status: 503 });
  }
}

/** "Find trades": works out trades for this pilot's seat and month now. */
export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to find trades." }, { status: 401 });
  // The trade board is a paid feature; a no-op while FREE_FOR_ALL is on (see lib/server/gating.ts).
  const gated = proFeatureRefusal(user, "trade-board");
  if (gated) return gated;
  if (!isVerified(user)) return confirmEmailRefusal("find trades");
  if (!(await checkRateLimit("trade-matches-find", user.id, 12, 60 * 60)).ok) return rateLimitedResponse();
  const body = await readJsonBody(request, 1_000);
  if (!isJsonObject(body) || !isText(body.pack, 200) || !body.pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  try {
    return NextResponse.json(await runMatching(user.id, body.pack as string));
  } catch (e) {
    await reportProblem("trades", e, { action: "find trades" });
    return NextResponse.json({ error: "Couldn't look for trades just now." }, { status: 503 });
  }
}
