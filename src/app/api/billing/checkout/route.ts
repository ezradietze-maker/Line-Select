import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getCurrentServerUser } from "@/lib/server/auth";
import { getSubscriptionByUserId, linkStripeCustomer } from "@/lib/server/db";
import { crossSiteRefusal } from "@/lib/server/same-origin";
import { appOrigin, freeMonthFor, getStripe, membershipEnded, planForStatus, stripeConfig, TRIAL_DAYS } from "@/lib/server/stripe";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** A membership the pilot still has (status not ended): a second beside it would bill them twice. */
function secondMembershipRefusal(status: string) {
  // A second tab can still show "Start free month" after the first finished checkout.
  if (planForStatus(status) === "pro") {
    return NextResponse.json({ error: "You already have a membership. Reload this page to manage it." }, { status: 409, headers: NO_STORE });
  }
  // Past due (or unpaid, incomplete, paused): still theirs, and a second bills twice once the card goes through.
  return NextResponse.json({ error: "Your last payment didn't go through. Update your card in the billing portal to keep your membership.", fixCard: true }, { status: 409, headers: NO_STORE });
}

/**
 * Leaves the pilot one checkout to finish, so they can't finish two and start two memberships (each with a free month):
 * one left open in another tab, or two started at once. The newest stays and every other is expired; a request whose own
 * session isn't the newest sends the pilot to the newest instead. Returns the URL to send them to.
 */
async function oneOpenCheckout(stripe: Stripe, customer: string, mine: Stripe.Checkout.Session): Promise<string> {
  const open = (await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 })).data;
  if (!open.some((s) => s.id === mine.id)) open.push(mine);
  const newest = open.reduce((a, b) => (b.created > a.created || (b.created === a.created && b.id > a.id) ? b : a));
  // One already finished or expired by the other request can't be expired again; that's fine.
  await Promise.all(open.filter((s) => s.id !== newest.id).map((s) => stripe.checkout.sessions.expire(s.id).catch(() => null)));
  return newest.url ?? mine.url!;
}

/** Starts a Stripe Checkout for the $20/mo membership, the first with a free month. The pilot enters their card on Stripe's page. */
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
    if (existing?.stripeSubscriptionId && !membershipEnded(existing.status)) return secondMembershipRefusal(existing.status);
    let customerId = existing?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.displayName, metadata: { userId: user.id } });
      // Save the link now so a webhook that races ahead of checkout completion can still find this pilot. A checkout
      // started at the same moment in another tab may have linked its own first: go on with that one.
      customerId = await linkStripeCustomer(user.id, customer.id);
    }
    // A checkout finished a moment ago (another tab) is at Stripe before its webhook reaches our row.
    const atStripe = (await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 })).data.find((s) => !membershipEnded(s.status));
    if (atStripe) return secondMembershipRefusal(atStripe.status);
    const freeMonth = await freeMonthFor(stripe, user.email, existing ?? { stripeCustomerId: customerId, stripeSubscriptionId: null, trialEndsAt: null });
    const origin = appOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      subscription_data: { ...(freeMonth ? { trial_period_days: TRIAL_DAYS } : {}), metadata: { userId: user.id } },
      client_reference_id: user.id,
      allow_promotion_codes: true,
      success_url: `${origin}/membership?checkout=success`,
      cancel_url: `${origin}/membership?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ url: await oneOpenCheckout(stripe, customerId, session) }, { headers: NO_STORE });
  } catch (e) {
    await reportProblem("billing", e, { userId: user.id });
    return NextResponse.json({ error: "Couldn't start checkout just now. Try again in a moment." }, { status: 503, headers: NO_STORE });
  }
}
