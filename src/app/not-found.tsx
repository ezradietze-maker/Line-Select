import Link from "next/link";

/**
 * A wrong or outdated link — shown inside the app's own shell (sidebar and
 * all) instead of Next.js's bare black default, with a way back.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-16 text-center animate-fade-in">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">404 · off the route</span>
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
    </div>
  );
}
