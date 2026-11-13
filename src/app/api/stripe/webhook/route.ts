import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import {
  getSubscriptionByCustomerId,
  getSubscriptionByUserId,
  markStripeEventProcessed,
  saveSubscription,
  setUserPlan,
  stripeEventProcessed,
} from "@/lib/server/db";
import { billingEnabled, getStripe, planForStatus, snapshotOf, userIdFromSubscription, webhookSecret } from "@/lib/server/stripe";

export const runtime = "nodejs";

/** Find the pilot behind a subscription: the id we stamped at checkout first, else our customer mapping. */
async function resolveUserId(sub: Stripe.Subscription, customerId: string): Promise<string | null> {
  const fromMeta = userIdFromSubscription(sub);
  if (fromMeta) return fromMeta;
  const existing = await getSubscriptionByCustomerId(customerId);
  return existing?.userId ?? null;
}

/**
 * Mirror a Stripe subscription into our tables and keep `users.plan` in step
 * with its status. `eventCreatedAt` is the event's own timestamp: Stripe does
 * not guarantee delivery order, so an event older than the one that last wrote
 * this pilot's row is ignored rather than allowed to regress a newer state
 * (e.g. a late "updated=active" arriving after a "deleted=canceled").
 */
async function applySubscription(sub: Stripe.Subscription, eventCreatedAt: Date): Promise<void> {
  const snap = snapshotOf(sub);
  const userId = await resolveUserId(sub, snap.stripeCustomerId);
  if (!userId) return; // A customer we don't know — nothing to update.
  const existing = await getSubscriptionByUserId(userId);
  const lastEventAt = existing?.lastEventAt ? new Date(existing.lastEventAt) : null;
  if (lastEventAt && eventCreatedAt < lastEventAt) return; // A newer event already wrote this row — don't go backwards.
  await saveSubscription(userId, snap, eventCreatedAt);
  await setUserPlan(userId, planForStatus(sub.status));
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  const eventCreatedAt = new Date(event.created * 1000);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object, eventCreatedAt);
      break;
    case "checkout.session.completed": {
      const subRef = event.data.object.subscription;
      if (subRef) {
        const subId = typeof subRef === "string" ? subRef : subRef.id;
        await applySubscription(await getStripe().subscriptions.retrieve(subId), eventCreatedAt);
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
    // Stripe delivers at least once; skip an id we've already fully handled so a replay can't re-run side effects.
    if (await stripeEventProcessed(event.id)) return NextResponse.json({ received: true, duplicate: true });
    await handleEvent(event);
    // Record it only after the handler succeeds, so a failed event (500 below) is retried, not silently dropped.
    await markStripeEventProcessed(event.id, event.type);
  } catch (e) {
    await reportProblem("billing", e, { type: event.type });
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
