"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAppState } from "@/lib/app-state";
import { isSamplePack } from "@/lib/fake-trade-offers";

const FREE_FEATURES = [
  "The full adaptive preference interview",
  "Every line in your bid pack scored against your own Satisfaction Index, with a detailed month calendar for each",
  "A bid forecast: your chance at every line, from where your seniority number puts you in bid order",
  "The Strategies board, including score-lift context and real award-history grounding",
  "Trade Board, Inbox, and Hotel Ratings",
  "Bid-order export and .ics calendar export",
];

export default function PricingPage() {
  const router = useRouter();
  const { user, bidPack, handleTrySample } = useAppState();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Line Select"
        title="Pricing"
        description={
          <>
            Line Select is free today. Everything below is a working feature, not a trial &mdash; there&rsquo;s nothing here held
            back for a future paid tier. (With the sample pack, the Trade Board shows clearly marked example offers.)
          </>
        }
      />

      {/* The plan you're on: lit in amber, not the grey of something switched off. */}
      <div className="panel-glass relative mt-6 overflow-hidden p-5 sm:p-6">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">Free</h2>
          <span className="font-mono text-lg font-semibold text-accent">$0</span>
        </div>
        <ul className="mt-4 space-y-2">
          {/* Each one ticked off in turn, the way the bid checklist ticks. */}
          {FREE_FEATURES.map((f, i) => (
            <li key={f} className="flex gap-2.5 text-sm text-ink">
              <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
                <path className="tick-draw" style={{ animationDelay: `${200 + i * 110}ms` }} strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          {bidPack && !user && isSamplePack(bidPack) ? (
            // An account doesn't keep the sample pack, so there's no progress on it to save: signing in leads to
            // uploading their own.
            <>
              <Button onClick={() => router.push("/auth")}>Sign in</Button>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">The sample pack stays on this device. Once you&rsquo;re signed in, you&rsquo;ll upload your own bid pack.</p>
            </>
          ) : bidPack ? (
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
