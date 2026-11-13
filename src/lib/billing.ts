/**
 * Thin client for the membership API (see `app/api/billing/*`). The pilot's
 * card is only ever entered on Stripe's own hosted pages, which these calls
 * redirect to — nothing sensitive passes through here.
 */

export interface BillingStatus {
  /** Whether this deployment has Stripe configured at all. */
  enabled: boolean;
  plan: "free" | "pro";
  /** Stripe's status, e.g. "trialing" | "active" | "canceled" — null before any checkout. */
  status: string | null;
  hasSubscription: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  try {
    const res = await fetch("/api/billing/status", { credentials: "same-origin" });
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}

async function redirectTo(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
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

/** Sends the pilot to Stripe Checkout to start their free month. */
export async function startMembershipCheckout(): Promise<{ ok: boolean; error?: string }> {
  return redirectTo("/api/billing/checkout");
}

/** Sends the pilot to Stripe's customer portal to update their card or cancel. */
export async function openBillingPortal(): Promise<{ ok: boolean; error?: string }> {
  return redirectTo("/api/billing/portal");
}
