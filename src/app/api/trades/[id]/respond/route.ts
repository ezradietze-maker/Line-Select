import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { findTradeOffer, updateTradeOffer } from "@/lib/server/db";
import type { LineSnapshot } from "@/types/trade";

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

  let body: { responderLine?: LineSnapshot };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.responderLine) {
    return NextResponse.json({ error: "Missing your line details." }, { status: 400 });
  }
  if (offer.wantedLineNumber && body.responderLine.lineNumber !== offer.wantedLineNumber) {
    return NextResponse.json(
      { error: `This pilot wants Line ${offer.wantedLineNumber} specifically.` },
      { status: 400 }
    );
  }

  const updated = await updateTradeOffer(id, {
    status: "pending",
    responderUserId: user.id,
    responderDisplayName: user.displayName,
    responderLine: body.responderLine,
    respondedAt: new Date().toISOString(),
  });

  return NextResponse.json({ offer: updated });
}
