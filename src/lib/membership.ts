import type { UserAccount } from "@/types/auth";

/**
 * The membership model, in one pure place both the server and the browser read (no server-only imports here).
 *
 * Two tiers, both all-access for now: **Free** (capped at `FREE_MEMBER_CAP` new pilots, then it shuts off) and
 * **Pro** ($20/mo). A pilot has access when they are grandfathered (account made before `MEMBERSHIP_CUTOVER`), hold a
 * claimed free slot, or carry an active/trialing Pro subscription (`plan === "pro"`, kept in step by the Stripe
 * webhook). Everyone else is "locked": they can still sign in and upload, but the ranking and tools are gated.
 *
 * `FREE_FOR_ALL` is the master switch. While it is true, everyone has access regardless of tier — so this whole
 * model ships and sits dormant, changing nothing. At go-live, set `MEMBERSHIP_CUTOVER` to that moment and flip
 * `FREE_FOR_ALL` to false to start enforcing it, with no other code change.
 */

/** Master switch. true = the whole app is free for everyone (today). false = enforce the Free/Pro model below. */
export const FREE_FOR_ALL = true;

/** How many new pilots may claim the free tier before it shuts off and new pilots must subscribe to Pro. */
export const FREE_MEMBER_CAP = 15;

/**
 * Accounts created before this are grandfathered: full access, no slot used. Set it to the go-live moment when you
 * flip `FREE_FOR_ALL` to false, so every existing pilot keeps access and only genuinely new sign-ups face the cap.
 */
export const MEMBERSHIP_CUTOVER = "2026-12-01T00:00:00Z";

export type MembershipTier = "grandfathered" | "pro" | "free" | "locked";

/** The shape of the fields the model reads off a user — a subset of `UserAccount`. */
type MembershipUser = Pick<UserAccount, "createdAt" | "plan" | "freeMemberAt">;

function isGrandfathered(user: Pick<UserAccount, "createdAt">): boolean {
  const made = Date.parse(user.createdAt);
  return Number.isFinite(made) && made < Date.parse(MEMBERSHIP_CUTOVER);
}

/** The pilot's tier on the merits, ignoring the master switch — what they'd be once enforcement is on. */
export function membershipTier(user: MembershipUser | null): MembershipTier {
  if (!user) return "locked";
  if (isGrandfathered(user)) return "grandfathered";
  if (user.plan === "pro") return "pro";
  if (user.freeMemberAt) return "free";
  return "locked";
}

/** The enforced check, ignoring the master switch: does the pilot hold any membership (not "locked")? */
export function isMember(user: MembershipUser | null): boolean {
  return membershipTier(user) !== "locked";
}

/** Whether the pilot may use the ranking and tools. True for everyone while `FREE_FOR_ALL` is on. */
export function hasAccess(user: MembershipUser | null): boolean {
  return FREE_FOR_ALL || isMember(user);
}

/** Free slots left, floored at zero, given how many have already been claimed. */
export function freeSlotsLeft(claimed: number): number {
  return Math.max(0, FREE_MEMBER_CAP - claimed);
}
