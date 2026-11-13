import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import { getSubscriptionByCustomerId, saveSubscription, setUserPlan } from "@/lib/server/db";
import { billingEnabled, getStripe, planForStatus, snapshotOf, userIdFromSubscription, webhookSecret } from "@/lib/server/stripe";

export const runtime = "nodejs";

/** Find the pilot behind a subscription: the id we stamped at checkout first, else our customer mapping. */
async function resolveUserId(sub: Stripe.Subscription, customerId: string): Promise<string | null> {
  const fromMeta = userIdFromSubscription(sub);
  if (fromMeta) return fromMeta;
  const existing = await getSubscriptionByCustomerId(customerId);
  return existing?.userId ?? null;
}

/** Mirror a Stripe subscription into our tables and keep `users.plan` in step with its status. */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const snap = snapshotOf(sub);
  const userId = await resolveUserId(sub, snap.stripeCustomerId);
  if (!userId) return; // A customer we don't know — nothing to update.
  await saveSubscription(userId, snap);
  await setUserPlan(userId, planForStatus(sub.status));
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object);
      break;
    case "checkout.session.completed": {
      const subRef = event.data.object.subscription;
      if (subRef) {
        const subId = typeof subRef === "string" ? subRef : subRef.id;
        await applySubscription(await getStripe().subscriptions.retrieve(subId));
      }
      break;
    }
    default:
      break;
  }
}

/** Stripe calls this when a membership starts, renews, or ends. Verified by signature; never trusts the body alone. */
export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret || !billingEnabled()) return NextResponse.json({ error: "Billing isn't configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    await handleEvent(event);
  } catch (e) {
    await reportProblem("billing", e, { type: event.type });
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
