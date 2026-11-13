import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { confirmEmailRefusal, isVerified } from "@/lib/server/verified-pilots";
import { acceptTradeOffer, findTradeOffer } from "@/lib/server/db";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { offerForViewer } from "@/lib/server/trade-view";

export const runtime = "nodejs";

/** Agrees a proposed trade. Both trips are then spoken for, so every other offer giving one of them is freed (`acceptTradeOffer`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!isVerified(user)) return confirmEmailRefusal("agree a trade");

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

  // The proposal the pilot saw, so one taken off and replaced by another pilot's in the meantime isn't agreed unseen.
  const body = await readJsonBody(request, 1_000);
  const respondedAt = isJsonObject(body) && typeof body.respondedAt === "string" ? body.respondedAt.slice(0, 40) : null;
  const updated = await acceptTradeOffer(id, respondedAt);
  if (updated === "traded") {
    return NextResponse.json({ error: "One of these trips is already in a trade agreed this month." }, { status: 409 });
  }
  if (!updated) {
    return NextResponse.json({ error: "This offer isn't waiting on that proposal any more. Have another look at it." }, { status: 409 });
  }
  return NextResponse.json({ offer: offerForViewer(updated, user.id) });
}
