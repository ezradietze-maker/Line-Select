import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { findTradeOffer, updateTradeOffer } from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { id } = await params;
  const offer = await findTradeOffer(id);
  if (!offer) {
    return NextResponse.json({ error: "That trade offer no longer exists." }, { status: 404 });
  }
  if (offer.offeringUserId !== user.id) {
    return NextResponse.json({ error: "Only the offering pilot can accept this." }, { status: 403 });
  }
  if (offer.status !== "pending") {
    return NextResponse.json({ error: "This offer isn't waiting on a response." }, { status: 409 });
  }

  const updated = await updateTradeOffer(id, {
    status: "accepted",
    resolvedAt: new Date().toISOString(),
  });
  return NextResponse.json({ offer: updated });
}
