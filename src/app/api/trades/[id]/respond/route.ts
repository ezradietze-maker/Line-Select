import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { findTradeOffer, updateTradeOffer } from "@/lib/server/db";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { sanitizeTripSnapshot } from "@/lib/server/trade-validation";
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
  if (offer.wantedPairingNumber && responderTrip.pairingNumber !== offer.wantedPairingNumber) {
    return NextResponse.json(
      { error: `This pilot wants Pairing ${offer.wantedPairingNumber} specifically.` },
      { status: 400 }
    );
  }

  const updated = await updateTradeOffer(
    id,
    {
      status: "pending",
      responderUserId: user.id,
      responderDisplayName: user.displayName,
      responderTrip,
      respondedAt: new Date().toISOString(),
    },
    ["open"]
  );
  if (!updated) {
    return NextResponse.json({ error: "This offer isn't open anymore." }, { status: 409 });
  }

  return NextResponse.json({ offer: updated });
}
