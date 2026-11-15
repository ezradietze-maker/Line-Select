import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { countFreeMembers, getSubscriptionByUserId } from "@/lib/server/db";
import { billingEnabled, freeMonthFor, getStripe, membershipEnded } from "@/lib/server/stripe";
import { freeSlotsLeft, hasAccess, membershipTier } from "@/lib/membership";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** The pilot's membership state, for the /membership screen. */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your membership." }, { status: 401, headers: NO_STORE });
  const enabled = billingEnabled();
  const sub = enabled ? await getSubscriptionByUserId(user.id) : null;
  const claimed = await countFreeMembers();
  // Asked only of a pilot who could start one now: whether it comes with the free month.
  const canStart = enabled && (!sub?.stripeSubscriptionId || membershipEnded(sub.status));
  const freeMonth = canStart ? await freeMonthFor(getStripe(), user.email, sub).catch(() => false) : false;
  // A live trial/active membership can be set to cancel at period end: Stripe keeps the status as-is and only flips
  // this flag, so our mirrored row still reads "trialing". Read it live to show the pilot their membership is ending.
  const live =
    sub?.stripeSubscriptionId && (sub.status === "trialing" || sub.status === "active")
      ? await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId).catch(() => null)
      : null;
  return NextResponse.json(
    {
      enabled,
      plan: user.plan ?? "free",
      status: sub?.status ?? null,
      hasSubscription: Boolean(sub?.stripeSubscriptionId),
      freeMonth,
      cancelAtPeriodEnd: live?.cancel_at_period_end === true,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      // The two-tier model (see `@/lib/membership`): the pilot's tier, whether they can use the app, and how many
      // free slots remain, so the membership screen can show "Free — X of 15 left" and lock the right pilots.
      tier: membershipTier(user),
      hasAccess: hasAccess(user),
      freeSlotsLeft: freeSlotsLeft(claimed),
    },
    { headers: NO_STORE }
  );
}
