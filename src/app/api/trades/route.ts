import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createTradeOffer, listTradeOffers } from "@/lib/server/db";
import type { BidPackMetaSnapshot, TripSnapshot, TradeOffer } from "@/types/trade";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ offers: await listTradeOffers() });
}

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to post a trade offer." }, { status: 401 });
  }

  let body: {
    bidPackMeta?: BidPackMetaSnapshot;
    offeredTrip?: TripSnapshot;
    wantedPairingNumber?: string | null;
    note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { bidPackMeta, offeredTrip, wantedPairingNumber, note } = body;
  if (!bidPackMeta || !offeredTrip) {
    return NextResponse.json({ error: "Missing bid pack or offered trip details." }, { status: 400 });
  }

  const offer: TradeOffer = {
    id: randomUUID(),
    bidPackMeta,
    offeringUserId: user.id,
    offeringDisplayName: user.displayName,
    offeredTrip,
    wantedPairingNumber: wantedPairingNumber?.trim() || null,
    note: note?.trim() || null,
    status: "open",
    createdAt: new Date().toISOString(),
    responderUserId: null,
    responderDisplayName: null,
    responderTrip: null,
    respondedAt: null,
    resolvedAt: null,
  };

  await createTradeOffer(offer);
  return NextResponse.json({ offer });
}
