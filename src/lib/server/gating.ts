import { NextResponse } from "next/server";
import type { UserAccount } from "@/types/auth";
import { hasProAccess } from "@/lib/server/stripe";
import { hasAccess } from "@/lib/membership";

/**
 * Membership gating lives in one place so the free/paid split is a list, not a
 * hunt through routes. `stripe.ts` owns the one question "is this pilot pro?"
 * (`hasProAccess`, today forced true by `FREE_FOR_ALL`); this file owns "which
 * features cost money" and how a route turns a non-member away.
 *
 * To make a feature paid: add it to `PRO_FEATURES`, then call
 * `proFeatureRefusal(user, "its-key")` at the feature's server entry point
 * (right after the sign-in check) — see `docs/launch/billing-gating-plan.md`.
 * While `FREE_FOR_ALL` is on every gate is a no-op, so gates can be wired up
 * ahead of the decision to charge; flipping the flag turns them all on at once.
 */

/** The paid-only features. The value is the pilot-facing phrase in the "membership unlocks …" message. */
export const PRO_FEATURES = {
  "trade-board": "the trade board and trade matching",
  "open-time": "open-time scoring",
  "contract-chat": "Ask the Contract",
  "calendar-feed": "the live calendar feed",
  "send-to-vips": "sending your bid to VIPS",
} as const;

export type ProFeature = keyof typeof PRO_FEATURES;

/**
 * Does this pilot's plan include `feature`? For UI and non-route callers that
 * need a boolean (a server component deciding whether to show a Pro panel).
 * Routes use `proFeatureRefusal` instead, so the 402 is consistent everywhere.
 */
export function canUseProFeature(user: Pick<UserAccount, "plan"> | null, feature: ProFeature): boolean {
  // `feature` is accepted (and validated as a real key by the type) so callers
  // read as "can this pilot use X"; the gate itself is plan-wide for now.
  void feature;
  return hasProAccess(user);
}

/**
 * A route gate: returns a 402 "Payment Required" response when `feature` is
 * paid and this pilot isn't a member, or `null` when they may proceed. Mirrors
 * the `crossSiteRefusal` / `confirmEmailRefusal` pattern the routes already use:
 *
 *   const gated = proFeatureRefusal(user, "trade-board");
 *   if (gated) return gated;
 */
export function proFeatureRefusal(user: Pick<UserAccount, "plan"> | null, feature: ProFeature): NextResponse | null {
  if (hasProAccess(user)) return null;
  return NextResponse.json(
    { error: `A Line Select membership unlocks ${PRO_FEATURES[feature]}.`, feature, upgrade: "/membership" },
    { status: 402, headers: { "Cache-Control": "private, no-store" } }
  );
}

/**
 * The whole-app gate: a 402 when this pilot has no membership (not grandfathered, no free slot, no Pro), or `null`
 * when they may proceed. Both tiers are all-access, so routes guard on *membership*, not on Pro specifically — use
 * this rather than `proFeatureRefusal`. A no-op while `FREE_FOR_ALL` is on (see `@/lib/membership`).
 */
export function accessRefusal(user: UserAccount | null): NextResponse | null {
  if (hasAccess(user)) return null;
  return NextResponse.json(
    { error: "A Line Select membership unlocks this. Start yours to carry on.", upgrade: "/membership" },
    { status: 402, headers: { "Cache-Control": "private, no-store" } }
  );
}
