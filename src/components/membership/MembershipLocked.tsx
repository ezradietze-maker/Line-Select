import Link from "next/link";

/**
 * Shown in place of the ranked lines when a pilot has no membership (see `@/lib/membership`). They can still sign in
 * and upload — only the ranking and tools are behind a membership. Dormant while `FREE_FOR_ALL` is on.
 */
export function MembershipLocked() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 py-12 text-center">
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">Start your membership to see your ranked lines</h1>
      <p className="text-sm leading-relaxed text-ink-muted">
        Your bid pack is uploaded and ready. Ranking every line to how you bid — plus sorts, filters, the calendar feed
        and Send to VIPS — comes with a Line Select membership: a free spot if any are left, or Pro at $20/month with
        your first month free.
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
