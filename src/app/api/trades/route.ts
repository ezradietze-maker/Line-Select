import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createTradeOffer, listTradeOffers } from "@/lib/server/db";
import type { BidPackMetaSnapshot, LineSnapshot, TradeOffer } from "@/types/trade";

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
    offeredLine?: LineSnapshot;
    wantedLineNumber?: string | null;
    note?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { bidPackMeta, offeredLine, wantedLineNumber, note } = body;
  if (!bidPackMeta || !offeredLine) {
    return NextResponse.json({ error: "Missing bid pack or offered line details." }, { status: 400 });
  }

  const offer: TradeOffer = {
    id: randomUUID(),
    bidPackMeta,
    offeringUserId: user.id,
    offeringDisplayName: user.displayName,
    offeredLine,
    wantedLineNumber: wantedLineNumber?.trim() || null,
    note: note?.trim() || null,
    status: "open",
    createdAt: new Date().toISOString(),
    responderUserId: null,
    responderDisplayName: null,
    responderLine: null,
    respondedAt: null,
    resolvedAt: null,
  };

  await createTradeOffer(offer);
  return NextResponse.json({ offer });
}
