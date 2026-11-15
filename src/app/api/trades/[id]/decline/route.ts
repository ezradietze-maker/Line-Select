import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { findTradeOffer, updateTradeOffer } from "@/lib/server/db";
import { isJsonObject, readJsonBody } from "@/lib/server/json-body";
import { offerForViewer } from "@/lib/server/trade-view";

export const runtime = "nodejs";

/** Said when the proposal on an offer isn't the one the pilot answered. */
const NOT_THAT_PROPOSAL = "This offer isn't waiting on that proposal any more. Have another look at it.";

export async function POST(
  request: Request,
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
    return NextResponse.json({ error: "Only the offering pilot can decline this." }, { status: 403 });
  }
  if (offer.status !== "pending") {
    return NextResponse.json({ error: "This offer isn't waiting on a response." }, { status: 409 });
  }

  // The proposal the pilot saw, as for an accept: one taken off and replaced by another pilot's in the meantime was
  // declined unseen, and the offer closed with it.
  const body = await readJsonBody(request, 1_000);
  const sent = isJsonObject(body) && typeof body.respondedAt === "string" ? body.respondedAt.slice(0, 40) : null;
  const respondedAt = sent && Number.isFinite(Date.parse(sent)) ? new Date(sent).toISOString() : undefined;
  if (respondedAt && offer.respondedAt !== respondedAt) return NextResponse.json({ error: NOT_THAT_PROPOSAL }, { status: 409 });

  const updated = await updateTradeOffer(id, { status: "declined", resolvedAt: new Date().toISOString() }, ["pending"], respondedAt);
  if (!updated) {
    return NextResponse.json({ error: respondedAt ? NOT_THAT_PROPOSAL : "This offer isn't waiting on a response." }, { status: 409 });
  }
  return NextResponse.json({ offer: offerForViewer(updated, user.id) });
}
