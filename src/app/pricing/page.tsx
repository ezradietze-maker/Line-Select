"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { useAppState } from "@/lib/app-state";

const FREE_FEATURES = [
  "The full adaptive preference interview",
  "Every line in your bid pack scored against your own Satisfaction Index",
  "The Strategies board, including score-lift context and real award-history grounding",
  "Trade Board, Inbox, and Hotel Ratings",
  "Bid-order export and .ics calendar export",
];

export default function PricingPage() {
  const router = useRouter();
  const { user, bidPack, handleTrySample } = useAppState();

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in">
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">
        Pricing
      </Heading>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Line Select is free today. Everything below is real, not a trial — there&rsquo;s no
        feature here held back for a future paid tier.
      </p>

      <div className="mt-6 rounded-xl border border-brand/30 bg-brand-soft p-5 sm:p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Free</h2>
          <span className="text-sm font-medium text-brand">$0</span>
        </div>
        <ul className="mt-4 space-y-2">
          {FREE_FEATURES.map((f) => (
            <li key={f} className="flex gap-2 text-sm text-ink-muted">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          {bidPack ? (
            <Button onClick={() => router.push(user ? "/results" : "/auth")}>
              {user ? "Go to your rankings" : "Sign in to save your progress"}
            </Button>
          ) : (
            <Button onClick={handleTrySample}>Try it with sample data</Button>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border-strong border-dashed bg-canvas p-5 sm:p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink-faint">Pro</h2>
          <span className="text-sm font-medium text-ink-faint">Pricing to be announced</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-faint">
          Nothing in the app is gated behind this yet &mdash; there&rsquo;s no feature list to show
          because there&rsquo;s no Pro-only feature built. This card exists so pricing has a real
          place to land once there is one, not to imply a specific feature is coming.
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-faint">
        Questions about pricing?{" "}
        <Link href="/how-it-works" className="underline decoration-dotted underline-offset-4 hover:text-ink-muted">
          See how this works
        </Link>
        , or upload a real bid pack to see the whole product before deciding anything.
      </p>
    </div>
  );
}
