import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { findTradeOffer, updateTradeOffer } from "@/lib/server/db";
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
  if (!body.responderTrip) {
    return NextResponse.json({ error: "Missing your trip details." }, { status: 400 });
  }
  if (offer.wantedPairingNumber && body.responderTrip.pairingNumber !== offer.wantedPairingNumber) {
    return NextResponse.json(
      { error: `This pilot wants Pairing ${offer.wantedPairingNumber} specifically.` },
      { status: 400 }
    );
  }

  const updated = await updateTradeOffer(id, {
    status: "pending",
    responderUserId: user.id,
    responderDisplayName: user.displayName,
    responderTrip: body.responderTrip,
    respondedAt: new Date().toISOString(),
  });

  return NextResponse.json({ offer: updated });
}
