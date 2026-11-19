import Link from "next/link";
import { useAppState } from "@/lib/app-state";
import { MEMBERSHIP_PRICE } from "@/lib/billing";
import { isSamplePack } from "@/lib/fake-trade-offers";

/**
 * Shown in place of the ranked lines, or one of the tools, when a pilot has no membership (see `@/lib/membership`).
 * They can still sign in, upload and take the interview — the ranking and tools are behind a membership (Ask the
 * Contract stays a small free teaser). Dormant while `FREE_FOR_ALL` is on.
 *
 * `tool` names the screen being held back ("Open Time", "the Pay check"); left out, it's the ranked lines.
 */
export function MembershipLocked({ tool }: { tool?: string } = {}) {
  // A guest trying the sample was told "Your bid pack is uploaded and ready": say which pack it is, and that a
  // membership needs an account (the membership page says the same to a guest).
  const { bidPack, user } = useAppState();
  const sample = !!bidPack && isSamplePack(bidPack);
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 py-12 text-center">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
        {tool ? `Start your membership to use ${tool}` : "Start your membership to see your ranked lines"}
      </h1>
      <p className="text-sm leading-relaxed text-ink-muted">
        {sample ? "You're looking at the sample bid pack." : "Your bid pack is uploaded and ready."} Ranking every line to how you bid, plus Strategies, Open Time, the Pay
        check, Logbook, Tools, Hotel Ratings, the Trade Board, the calendar feed and Send to VIPS, comes with a Line Select membership: a free spot if any are left, or Pro at {MEMBERSHIP_PRICE}.
        Your first membership starts with a free month.
        {!user && " Sign in from the account menu to start one."}
      </p>
      <Link
        href="/membership"
        className="inline-flex items-center rounded-[4px] bg-brand px-5 py-2.5 font-display text-sm font-bold text-on-brand transition-opacity hover:opacity-90"
      >
        See membership options
      </Link>
    </div>
  );
}
