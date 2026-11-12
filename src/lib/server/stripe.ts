import Stripe from "stripe";
import type { UserAccount } from "@/types/auth";

/**
 * Stripe is optional: the site runs perfectly with no billing configured
 * (every pilot is "free", which today means full access). These helpers all
 * degrade to "not set up yet" when the env vars are absent, the same way
 * `email.ts` handles a missing Resend key — so a deployment without Stripe
 * keys never crashes, it just doesn't offer paid membership.
 */

export interface StripeConfig {
  secretKey: string;
  priceId: string;
}

/** The secret key + the $20/mo price. Both are needed to start a checkout. */
export function stripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  return secretKey && priceId ? { secretKey, priceId } : null;
}

/** The webhook signing secret — needed only by the webhook route. */
export function webhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

export function billingEnabled(): boolean {
  return stripeConfig() !== null;
}

/** Which env vars are still missing, for a friendly "billing isn't set up yet" message. */
export function missingStripeEnv(): string[] {
  return (["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"] as const).filter((n) => !process.env[n]?.trim());
}

let client: Stripe | null = null;

/** The Stripe client. Throws if billing isn't configured — callers guard with `billingEnabled()` first. */
export function getStripe(): Stripe {
  const config = stripeConfig();
  if (!config) throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY and STRIPE_PRICE_ID.");
  if (!client) client = new Stripe(config.secretKey);
  return client;
}

/** The free month every new membership starts with. */
export const TRIAL_DAYS = 30;

/** The price shown to pilots. Keep in step with the Stripe price you create. */
export const MONTHLY_PRICE_LABEL = "$20/month";

/**
 * The membership the app grants for a given Stripe status. Only a live trial
 * or an active, paid subscription counts as "pro"; past-due, canceled,
 * incomplete and the rest fall back to "free".
 */
export function planForStatus(status: string): "free" | "pro" {
  return status === "trialing" || status === "active" ? "pro" : "free";
}

/**
 * Whether a pilot should get paid-only features. Today it returns true for
 * EVERYONE: the free tier is intentionally identical to Pro while you hand
 * access to test pilots. When you want a feature to be paid-only, gate it on
 * this helper; flip `FREE_FOR_ALL` to false (or delete it) to start enforcing
 * membership everywhere at once, with no other code change.
 */
const FREE_FOR_ALL: boolean = true;
export function hasProAccess(user: Pick<UserAccount, "plan"> | null): boolean {
  if (FREE_FOR_ALL) return true;
  return user?.plan === "pro";
}

export interface SubscriptionSnapshot {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
}

function secondsToDate(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

/**
 * The current period end moved from the Subscription onto its line item in
 * recent Stripe API versions, so read the item first and fall back to the
 * subscription for older versions — without assuming either field's presence.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items.data[0] as { current_period_end?: number } | undefined;
  const top = sub as unknown as { current_period_end?: number };
  return secondsToDate(item?.current_period_end ?? top.current_period_end ?? null);
}

/** Flattens a Stripe subscription into the row we store. */
export function snapshotOf(sub: Stripe.Subscription): SubscriptionSnapshot {
  return {
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: sub.items.data[0]?.price.id ?? null,
    currentPeriodEnd: periodEnd(sub),
    trialEndsAt: secondsToDate(sub.trial_end),
  };
}

/** The userId we stamped on the subscription at checkout, if present. */
export function userIdFromSubscription(sub: Stripe.Subscription): string | null {
  const id = sub.metadata?.userId;
  return typeof id === "string" && id ? id : null;
}

/**
 * The public origin to send pilots back to from Stripe. Prefers the
 * configured `APP_URL` (the real domain) over the request's own origin, which
 * on a serverless platform can be an internal address.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}
