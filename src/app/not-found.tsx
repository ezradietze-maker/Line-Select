import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

const PLACES = [
  { href: "/results", label: "Your rankings" },
  { href: "/cities", label: "Layover cities" },
  { href: "/logbook", label: "Logbook" },
  { href: "/tools", label: "Tools" },
];

/**
 * A wrong or outdated link — shown inside the app's own shell (sidebar and
 * all) instead of Next.js's bare black default, with a way back.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-16 text-center">
      {/* A plane holding: flying a racetrack pattern, waiting for somewhere to land. */}
      <div aria-hidden className="relative h-[70px] w-[160px] text-ink-faint">
        <svg viewBox="0 0 160 70" className="absolute inset-0 h-full w-full" fill="none" stroke="currentColor">
          <rect x="20" y="15" width="120" height="40" rx="20" strokeWidth="1.5" strokeDasharray="4 5" />
        </svg>
        <span className="holding-plane absolute left-0 top-0 block text-accent">
          <svg viewBox="-4 -4 8 8" className="h-3.5 w-3.5">
            <path d="M3.4 0 L-2.6 -2.4 L-1.4 0 L-2.6 2.4 Z" fill="currentColor" />
          </svg>
        </span>
      </div>
      <span className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">404 · holding</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-ink">This page isn&rsquo;t on the chart</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        The link may be old or mistyped. Your bid pack and preferences are safe &mdash; pick up where you left off.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-on-brand shadow-sm transition-colors hover:bg-brand-strong"
      >
        Back to Line Select
      </Link>
      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        {PLACES.map((p) => (
          <Link key={p.href} href={p.href} className="text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink">
            {p.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
