import { apiFetch } from "@/lib/shown-account";

/**
 * Thin client for the membership API (see `app/api/billing/*`). The pilot's
 * card is only ever entered on Stripe's own hosted pages, which these calls
 * redirect to — nothing sensitive passes through here.
 */

/** What a membership costs, as Stripe's price for it is set; said on the Membership and Pricing pages alike. */
export const MEMBERSHIP_PRICE = "$20/month";

export type MembershipTier = "grandfathered" | "pro" | "free" | "locked";

export interface BillingStatus {
  /** Whether this deployment has Stripe configured at all. */
  enabled: boolean;
  plan: "free" | "pro";
  /** Stripe's status, e.g. "trialing" | "active" | "canceled" — null before any checkout. */
  status: string | null;
  hasSubscription: boolean;
  /** Whether starting one now comes with the free month: only a pilot's first membership does. */
  freeMonth: boolean;
  /** A live membership (trial or active) the pilot has set to cancel at period end — still on now, but ending. */
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** The pilot's membership tier (see `@/lib/membership`). */
  tier: MembershipTier;
  /** Whether the pilot can use the ranking and tools right now. */
  hasAccess: boolean;
  /** Free slots left before the free tier shuts off. */
  freeSlotsLeft: number;
}

/**
 * Stripe statuses a subscription is over in, so a new one may start. Any other (past due, unpaid, incomplete, paused) is
 * still the pilot's: a second one beside it could leave them paying twice once the first card goes through, so they
 * fix the card in the portal instead.
 */
export function membershipEnded(status: string): boolean {
  return status === "canceled" || status === "incomplete_expired";
}

export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  try {
    const res = await apiFetch("/api/billing/status", { credentials: "same-origin" });
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}

async function redirectTo(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.url !== "string") {
      return { ok: false, error: data.error ?? "Something went wrong. Try again." };
    }
    window.location.assign(data.url);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Sends the pilot to Stripe Checkout to start their membership (the first with a free month). */
export async function startMembershipCheckout(): Promise<{ ok: boolean; error?: string }> {
  return redirectTo("/api/billing/checkout");
}

/** Sends the pilot to Stripe's customer portal to update their card or cancel. */
export async function openBillingPortal(): Promise<{ ok: boolean; error?: string }> {
  return redirectTo("/api/billing/portal");
}

/** Claims one of the limited free-membership slots. "full" means the slots are gone — subscribe instead. */
export async function claimFreeMembership(): Promise<{ ok: boolean; full?: boolean; error?: string }> {
  try {
    const res = await apiFetch("/api/billing/claim-free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.claimed) return { ok: true };
    if (res.status === 409 || data.reason === "full") return { ok: false, full: true, error: data.error ?? "The free spots are all taken." };
    return { ok: false, error: data.error ?? "Something went wrong. Try again." };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
