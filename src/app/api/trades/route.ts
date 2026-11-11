import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isJsonObject } from "@/lib/server/json-body";
import { getCurrentServerUser } from "@/lib/server/auth";
import { createTradeOffer, listTradeOffersForSeat } from "@/lib/server/db";
import { checkRateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { tradeBoardIsOpen } from "@/lib/server/trade-board-bar";
import { sanitizeBidPackMeta, sanitizeTripSnapshot } from "@/lib/server/trade-validation";
import { offerForViewer } from "@/lib/server/trade-view";
import type { Seat } from "@/types/bidpack";
import type { BidPackMetaSnapshot, TripSnapshot, TradeOffer } from "@/types/trade";

export const runtime = "nodejs";

/** The newest this many of a pilot's own offers, and of others' open ones: more than any one seat's month has had. */
export const BOARD_LIMIT = 200;

/**
 * One seat's board for one month, for signed-in pilots only: that seat's open offers and the pilot's own (any status),
 * with other pilots' account ids left out (`offerForViewer`). Until the seat's board opens (`tradeBoardIsOpen`) only
 * the pilot's own. Other seats' offers, and trades other pilots have in progress, never leave the server.
 */
export async function GET(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see the trade board." }, { status: 401 });
  // The app asks every ten seconds in each open window, for the Inbox badge.
  if (!(await checkRateLimit("trade-board-read", user.id, 1800, 60 * 60)).ok) return rateLimitedResponse();
  const meta = sanitizeBidPackMeta(Object.fromEntries(new URL(request.url).searchParams));
  if (!meta) return NextResponse.json({ error: "Which bid pack's board?" }, { status: 400 });
  const othersOpen = await tradeBoardIsOpen({ base: meta.base, aircraft: meta.aircraft, seat: meta.seat as Seat });
  const offers = await listTradeOffersForSeat(meta, user.id, { othersOpen, limit: BOARD_LIMIT });
  return NextResponse.json({ offers: offers.map((o) => offerForViewer(o, user.id)) }, { headers: { "Cache-Control": "private, no-store" } });
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

  // Every signed-in pilot can read the board, so cap how fast one account can fill it.
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
