import Link from "next/link";
import { MEMBERSHIP_PRICE } from "@/lib/billing";

/**
 * Under a non-member's Results: they see their top lines only (`FREE_PREVIEW_LINES`), and this says what the rest of
 * the ranking takes. Dormant while `FREE_FOR_ALL` is on, since everyone is a member then.
 */
export function MembershipPreviewNote({ shown, total }: { shown: number; total: number }) {
  return (
    <div className="panel-glass mt-4 flex flex-col items-center gap-3 px-4 py-5 text-center print:hidden">
      <p className="font-display text-base font-bold text-ink">
        Those are your top {shown} of {total} lines.
      </p>
      <p className="max-w-md text-sm leading-relaxed text-ink-muted">
        A Line Select membership shows you every line ranked, plus the bid-order export, Send to VIPS and the rest of
        the tools. A free spot if any are left, or Pro at {MEMBERSHIP_PRICE}. Your first membership starts with a free month.
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
