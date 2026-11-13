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
      {/* A holding pattern, drawn once and still: the racetrack, the fix it's held on, and the plane inbound to it. */}
      <svg aria-hidden viewBox="0 0 160 70" className="h-[70px] w-[160px]">
        <path
          className="route-draw"
          pathLength={1}
          d="M40 15 H120 A20 20 0 0 1 120 55 H40 A20 20 0 0 1 40 15 Z"
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={1.5}
        />
        <path d="M40 9 L46 15 L40 21 L34 15 Z" fill="var(--color-panel)" stroke="var(--color-ink-faint)" strokeWidth={1.5} />
        <path transform="translate(96 15)" d="M5.1 0 L-3.9 -3.6 L-2.1 0 L-3.9 3.6 Z" fill="var(--color-accent)" />
      </svg>
      <span className="mt-4 text-2xs text-accent font-medium">404 · holding</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-ink">This page isn&rsquo;t on the chart</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        The link may be old or mistyped. Your bid pack and preferences are safe &mdash; pick up where you left off.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-[4px] bg-brand px-4 py-2.5 font-display text-sm font-bold tracking-[0.01em] text-on-brand transition-colors hover:bg-brand-strong"
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
