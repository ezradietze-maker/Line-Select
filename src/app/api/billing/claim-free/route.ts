import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { claimFreeMember } from "@/lib/server/db";
import { crossSiteRefusal } from "@/lib/server/same-origin";

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
  const result = await claimFreeMember(user.id);
  if (result === "full") {
    return NextResponse.json(
      { claimed: false, reason: "full", error: "The free spots are all taken — you can start a membership instead." },
      { status: 409, headers: NO_STORE }
    );
  }
  return NextResponse.json({ claimed: true, already: result === "already" }, { headers: NO_STORE });
}
