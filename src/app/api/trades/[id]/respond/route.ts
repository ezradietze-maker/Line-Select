import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { confirmEmailRefusal, isVerified } from "@/lib/server/verified-pilots";
import { packIdFor } from "@/lib/pack-id";
import { findTradeOffer, getTradeHolding, pilotHasSeatMonth, respondToTradeOffer } from "@/lib/server/db";
import { offerForViewer } from "@/lib/server/trade-view";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { pastBoardDeadline, tooLateToTrade } from "@/lib/server/trade-deadline";
import { NOT_YOUR_SEAT, NOT_YOUR_TRIP, sanitizeTripSnapshot, tripIsHeld } from "@/lib/server/trade-validation";
import type { Seat } from "@/types/bidpack";
import type { TripSnapshot } from "@/types/trade";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to respond to a trade offer." }, { status: 401 });
  }
  if (!isVerified(user)) return confirmEmailRefusal("answer trade offers");

  const { id } = await params;
  const offer = await findTradeOffer(id);
  if (!offer) {
    return NextResponse.json({ error: "That trade offer no longer exists." }, { status: 404 });
  }
  if (offer.status !== "open") {
    return NextResponse.json({ error: "This offer isn't open anymore." }, { status: 409 });
  }
  if (offer.offeringUserId === user.id) {
    return NextResponse.json({ error: "You can't respond to your own offer." }, { status: 400 });
  }

  let body: { responderTrip?: TripSnapshot };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const responderTrip = sanitizeTripSnapshot(body.responderTrip);
  if (!responderTrip) {
    return NextResponse.json({ error: "Missing or malformed trip details." }, { status: 400 });
  }
  const { ok } = await checkRateLimit("trade-respond", user.id, 60, 60 * 60);
  if (!ok) return rateLimitedResponse();
  // Only a pilot who flies this seat's month may answer an offer on its board, with a trip they hold in it: an offer's
  // id is all a request needs, and an id can be passed on.
  if (!(await pilotHasSeatMonth(user.id, offer.bidPackMeta))) return NextResponse.json({ error: NOT_YOUR_SEAT }, { status: 403 });
  if (!tripIsHeld(await getTradeHolding(user.id, packIdFor({ ...offer.bidPackMeta, seat: offer.bidPackMeta.seat as Seat })), responderTrip)) {
    return NextResponse.json({ error: NOT_YOUR_TRIP }, { status: 403 });
  }
  if (offer.wantedPairingNumber && responderTrip.pairingNumber !== offer.wantedPairingNumber) {
    return NextResponse.json(
      { error: `This pilot wants Pairing ${offer.wantedPairingNumber} specifically.` },
      { status: 400 }
    );
  }
  if (await pastBoardDeadline(offer.bidPackMeta, [offer.offeredTrip, responderTrip], [user.id, offer.offeringUserId])) {
    return NextResponse.json({ error: tooLateToTrade(offer.bidPackMeta) }, { status: 409 });
  }

  // Refused when either trip is already in a trade one of the two pilots agreed: it's spoken for (`respondToTradeOffer`).
  const updated = await respondToTradeOffer(id, user, responderTrip);
  if (updated === "traded") {
    return NextResponse.json({ error: "One of these trips is already in a trade agreed this month." }, { status: 409 });
  }
  if (!updated) {
    return NextResponse.json({ error: "This offer isn't open anymore." }, { status: 409 });
  }

  return NextResponse.json({ offer: offerForViewer(updated, user.id) });
}
