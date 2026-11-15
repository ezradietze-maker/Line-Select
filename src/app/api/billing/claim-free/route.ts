import { NextResponse } from "next/server";
import { hasAccess } from "@/lib/membership";
import { getCurrentServerUser } from "@/lib/server/auth";
import { claimFreeMember } from "@/lib/server/db";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { confirmEmailRefusal, isVerified } from "@/lib/server/verified-pilots";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Claim one of the limited free-membership slots for the signed-in pilot (see `@/lib/membership`). The cap is
 * enforced atomically in the database, so this can safely be hit by anyone — it just answers "full" once the slots
 * are gone.
 */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  if (user.freeMemberAt) return NextResponse.json({ claimed: true, already: true }, { headers: NO_STORE });
  // A spot is for a pilot who has no other way in. One who already has the whole app (an account from before the
  // cutover, a live membership, or everyone while it's all free) kept it from a new pilot for good: nothing gives it back.
  if (hasAccess(user)) {
    return NextResponse.json(
      { claimed: false, reason: "member", error: "You already have full access. There's nothing you need to do." },
      { status: 409, headers: NO_STORE }
    );
  }
  // An account made in a minute, never confirmed, could otherwise take every spot.
  if (!isVerified(user)) return confirmEmailRefusal("claim a free spot");
  const result = await claimFreeMember(user.id);
  if (result === "full") {
    return NextResponse.json(
      { claimed: false, reason: "full", error: "The free spots are all taken — you can start a membership instead." },
      { status: 409, headers: NO_STORE }
    );
  }
  return NextResponse.json({ claimed: true, already: result === "already" }, { headers: NO_STORE });
}
