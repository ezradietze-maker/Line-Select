import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { getSubscriptionByUserId, linkStripeCustomer } from "@/lib/server/db";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { appOrigin, getStripe, stripeConfig, TRIAL_DAYS } from "@/lib/server/stripe";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Starts a Stripe Checkout for the $20/mo membership, with a free month. The pilot enters their card on Stripe's page. */
export async function POST(request: Request) {
  const refused = crossSiteRefusal(request);
  if (refused) return refused;
  const config = stripeConfig();
  if (!config) return NextResponse.json({ error: "Membership isn't set up on this site yet." }, { status: 503, headers: NO_STORE });
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to start a membership." }, { status: 401, headers: NO_STORE });
  try {
    const stripe = getStripe();
    const existing = await getSubscriptionByUserId(user.id);
    let customerId = existing?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.displayName, metadata: { userId: user.id } });
      customerId = customer.id;
      // Save the link now so a webhook that races ahead of checkout completion can still find this pilot.
      await linkStripeCustomer(user.id, customerId);
    }
    const origin = appOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      subscription_data: { trial_period_days: TRIAL_DAYS, metadata: { userId: user.id } },
      client_reference_id: user.id,
      allow_promotion_codes: true,
      success_url: `${origin}/membership?checkout=success`,
      cancel_url: `${origin}/membership?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ url: session.url }, { headers: NO_STORE });
  } catch (e) {
    await reportProblem("billing", e, { userId: user.id });
    return NextResponse.json({ error: "Couldn't start checkout just now. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
}
