import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { getSubscriptionByUserId } from "@/lib/server/db";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { appOrigin, billingEnabled, getStripe } from "@/lib/server/stripe";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Sends the pilot to Stripe's own customer portal to update their card or cancel. Stripe builds that screen. */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  if (!billingEnabled()) return NextResponse.json({ error: "Membership isn't set up on this site yet." }, { status: 503, headers: NO_STORE });
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage your membership." }, { status: 401, headers: NO_STORE });
  const sub = await getSubscriptionByUserId(user.id);
  if (!sub) return NextResponse.json({ error: "You don't have a membership to manage yet." }, { status: 400, headers: NO_STORE });
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appOrigin(request)}/membership`,
    });
    return NextResponse.json({ url: session.url }, { headers: NO_STORE });
  } catch (e) {
    await reportProblem("billing", e, { userId: user.id });
    return NextResponse.json({ error: "Couldn't open the billing portal just now. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
}
