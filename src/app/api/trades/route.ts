import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createTradeOffer, listTradeOffers } from "@/lib/server/db";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { sanitizeBidPackMeta, sanitizeTripSnapshot } from "@/lib/server/trade-validation";
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
  if (!isJsonObject(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const bidPackMeta = sanitizeBidPackMeta(body.bidPackMeta);
  const offeredTrip = sanitizeTripSnapshot(body.offeredTrip);
  if (!bidPackMeta || !offeredTrip) {
    return NextResponse.json({ error: "Missing or malformed bid pack or offered trip details." }, { status: 400 });
  }
  const wantedPairingNumber = typeof body.wantedPairingNumber === "string" ? body.wantedPairingNumber.trim().slice(0, 12) : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  // Everyone can read the board, so cap how fast one account can fill it.
  const { ok } = await checkRateLimit("trade-post", user.id, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();

  const offer: TradeOffer = {
    id: randomUUID(),
    bidPackMeta,
    offeringUserId: user.id,
    offeringDisplayName: user.displayName,
    offeredTrip,
    wantedPairingNumber: wantedPairingNumber || null,
    note: note || null,
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
