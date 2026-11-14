import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { getSubscriptionByUserId } from "@/lib/server/db";
import { billingEnabled, freeMonthFor, getStripe, membershipEnded } from "@/lib/server/stripe";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** The pilot's membership state, for the /membership screen. */
export async function GET() {
  const user = await getCurrentServerUser();
  if (!user) return NextResponse.json({ error: "Sign in to see your membership." }, { status: 401, headers: NO_STORE });
  const enabled = billingEnabled();
  const sub = enabled ? await getSubscriptionByUserId(user.id) : null;
  // Asked only of a pilot who could start one now: whether it comes with the free month.
  const canStart = enabled && (!sub?.stripeSubscriptionId || membershipEnded(sub.status));
  const freeMonth = canStart ? await freeMonthFor(getStripe(), user.email, sub).catch(() => false) : false;
  return NextResponse.json(
    {
      enabled,
      plan: user.plan ?? "free",
      status: sub?.status ?? null,
      hasSubscription: Boolean(sub?.stripeSubscriptionId),
      freeMonth,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    },
    { headers: NO_STORE }
  );
}
