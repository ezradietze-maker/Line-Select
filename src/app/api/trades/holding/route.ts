import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { packIdFor } from "@/lib/pack-id";
import { deleteTradeHolding, getBidPackRecord, getTradeHolding, getTradeSettings, saveTradeHolding } from "@/lib/server/db";
import { readJsonBody } from "@/lib/server/json-body";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { accountPackFingerprint } from "@/lib/server/trade-pack";
import { lapseSuggestionsFor } from "@/lib/server/trade-suggestions";
import { readHolding } from "@/lib/trades/holding";
import type { Seat } from "@/types/bidpack";

export const runtime = "nodejs";

const MAX_BODY = 20_000;
const packOf = (request: Request) => new URL(request.url).searchParams.get("pack")?.slice(0, 200) || null;

/** What a signed-in pilot has confirmed they hold in one bid pack (see `lib/trades/holding.ts`). Only ever their own. */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see what you hold." }, { status: 401 });
  if (!(await checkRateLimit("trade-holding-read", user.id, 240, 60 * 60)).ok) return rateLimitedResponse();
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  try {
    const [holding, settings] = await Promise.all([getTradeHolding(user.id, pack), getTradeSettings(user.id)]);
    return NextResponse.json({ holding, settings }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    await reportProblem("trades", e, { action: "read holding" });
    return NextResponse.json({ error: "Couldn't load what you hold just now." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to confirm what you hold." }, { status: 401 });
  if (!(await checkRateLimit("trade-holding-save", user.id, 120, 60 * 60)).ok) return rateLimitedResponse();
  const holding = readHolding(await readJsonBody(request, MAX_BODY));
  if (!holding) return NextResponse.json({ error: "That isn't a list of trips from your bid pack." }, { status: 400 });
  // A holding opens its seat's trade board to the pilot (`pilotHasSeatMonth`), so its seat has to be the pack's, and
  // the pack the one on their account: otherwise naming another seat's month opened that board, with its pilots' names
  // and notes. Only the current id: the older one doesn't name the aircraft, and a second row under it in the same month
  // was matched as a second pilot.
  if (holding.packId !== packIdFor({ ...holding.bidPackMeta, seat: holding.bidPackMeta.seat as Seat })) {
    return NextResponse.json({ error: "That isn't a list of trips from your bid pack." }, { status: 400 });
  }
  try {
    if ((await getBidPackRecord(user.id))?.packId !== holding.packId) {
      return NextResponse.json({ error: "Save this bid pack to your account first, then mark what you hold." }, { status: 409 });
    }
    // Which copy of the pack it was confirmed on, so it's only matched with others confirmed on the same one.
    const saved = await saveTradeHolding(user.id, holding, await accountPackFingerprint(user.id, holding.packId));
    // Every suggestion on this pack was worked out from what they held before.
    await lapseSuggestionsFor(user.id, holding.packId);
    return NextResponse.json({ holding: saved });
  } catch (e) {
    await reportProblem("trades", e, { action: "save holding" });
    return NextResponse.json({ error: "Couldn't save what you hold just now." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await checkRateLimit("trade-holding-save", user.id, 120, 60 * 60)).ok) return rateLimitedResponse();
  const pack = packOf(request);
  if (!pack) return NextResponse.json({ error: "Which bid pack?" }, { status: 400 });
  try {
    await deleteTradeHolding(user.id, pack);
    await lapseSuggestionsFor(user.id, pack);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await reportProblem("trades", e, { action: "remove holding" });
    return NextResponse.json({ error: "Couldn't remove that just now." }, { status: 503 });
  }
}
