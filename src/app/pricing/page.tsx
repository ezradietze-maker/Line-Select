"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAppState } from "@/lib/app-state";
import { MEMBERSHIP_PRICE } from "@/lib/billing";
import { FREE_MEMBER_CAP, FREE_PREVIEW_LINES } from "@/lib/membership";

/** What a membership (free spot or Pro, the same app) unlocks. */
const MEMBER_FEATURES = [
  "Every line in your bid pack ranked by your own Satisfaction Index, with the reason and a month calendar for each",
  "Trip Rankings: every trip in the pack, best first, learning from the trips you move",
  "Your vacation on every line, slid to its best legal spot for what you want from it",
  "Send to VIPS, the bid-order copy and the calendar feed",
  "Sorts, filters and Ask your pack",
  "Strategies, with your chance at every line from where your seniority number puts you in bid order",
  "The Pay check, Logbook, Tools and Hotel Ratings",
];

/** The Pro card's button: its side padding stays 16px with the text set large, so "membership" fits a 320 phone at 200%. */
const BIG_TEXT_BUTTON = "max-w-full px-[min(1rem,16px)]";

export default function PricingPage() {
  const router = useRouter();
  const { ready, user, bidPack, handleTrySample } = useAppState();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Line Select"
        title="Pricing"
        description={
          <>
            One membership, two ways in: one of the first {FREE_MEMBER_CAP} free spots, or Pro at {MEMBERSHIP_PRICE} with
            your first month free. Both unlock everything below. Without one you can still take the interview and see your
            top {FREE_PREVIEW_LINES} lines.
          </>
        }
      />

      {/* Pro, the paid way in, lit in amber. On a phone its padding, and its button's, stay as they are with the text set
          large: doubled, "See membership options" was cut at the card's edge on a 320 phone at 200%. */}
      <div className="panel-glass relative mt-6 overflow-hidden p-[min(1.25rem,20px)] sm:p-6">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
        {/* Wrapped: at 200% text on a 320 px phone the price ran past the card's edge and was cut. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-lg font-semibold text-ink">Pro</h2>
          {/* As the Membership page and Stripe's checkout have it (`MembershipScreen`, `TRIAL_DAYS`). */}
          <span className="font-mono text-lg font-semibold text-accent">{MEMBERSHIP_PRICE}</span>
        </div>
        <ul className="mt-4 space-y-2">
          {/* Each one ticked off in turn, the way the bid checklist ticks. */}
          {MEMBER_FEATURES.map((f, i) => (
            <li key={f} className="flex gap-2.5 text-sm text-ink">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                <path className="tick-draw" style={{ animationDelay: `${200 + i * 110}ms` }} strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">Your first month is free. Cancel any time from Membership, in your account menu.</p>
        <div className="mt-5">
          {/* The page's words are in the server's HTML; what to offer waits for the pilot's account. */}
          {!ready ? (
            <div aria-hidden data-pricing-placeholder className="skeleton-pulse h-[42px] w-52 rounded-md bg-border" />
          ) : user ? (
            <Button onClick={() => router.push("/membership")} className={BIG_TEXT_BUTTON}>See membership options</Button>
          ) : bidPack ? (
            <Button onClick={() => router.push("/auth")} className={BIG_TEXT_BUTTON}>Sign in to start your membership</Button>
          ) : (
            <Button onClick={handleTrySample} className={BIG_TEXT_BUTTON}>Try it with sample data</Button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border-strong bg-canvas p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-lg font-semibold text-ink">Free membership</h2>
          <span className="font-mono text-lg font-semibold text-ink-muted">$0</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          The first {FREE_MEMBER_CAP} pilots to claim a spot get the same membership as Pro, free. Claim one on the Membership
          page once your email is confirmed; when they&rsquo;re gone, they&rsquo;re gone.
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-faint">
        Questions about pricing?{" "}
        <Link href="/how-it-works" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
          See how this works
        </Link>
        , or upload your own bid pack and see your top lines before deciding anything.
      </p>
    </div>
  );
}
