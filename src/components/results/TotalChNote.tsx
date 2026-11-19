"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatHoursValue } from "@/lib/interview-config";
import { BLOCK_OVERRIDE_ON, totalDiffers, type LineTotal } from "@/lib/pay/line-total";
import { setPayOrder } from "@/lib/pay/pay-order";
import type { Line } from "@/types/bidpack";

const hm = formatHoursValue;
const signed = (ch: number) => (ch < 0 ? `−${hm(-ch)}` : `+${hm(ch)}`);

/**
 * Under a line: its Total CH when that isn't what the pack prints (CR. plus C/O), with how it adds up behind a tap. A line
 * nothing happens to says nothing: its pack figures are already its pay.
 */
export function TotalChLineNote({ line, total }: { line: Line | undefined; total: LineTotal | undefined }) {
  const [open, setOpen] = useState(false);
  if (!line || !total || (!totalDiffers(line, total) && total.fromVacationBank === 0)) return null;
  return (
    <div className="mt-1 px-3 text-xs text-ink-muted" data-total-ch={line.lineNumber}>
      <button type="button" className="text-left underline decoration-dotted underline-offset-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Total CH {hm(total.total)}
        {totalDiffers(line, total) ? `, not the ${hm(line.totalCreditHours + (line.carryOverCreditHours ?? 0))} the pack prints` : ""}
      </button>
      {open && <TotalChBreakdown total={total} />}
    </div>
  );
}

/** How a line's Total CH adds up, each part with its section. */
export function TotalChBreakdown({ total }: { total: LineTotal }) {
  return (
    <div className="mt-1 space-y-1">
      <ul className="space-y-0.5">
        {total.parts.map((p, i) => (
          <li key={p.id} className="flex justify-between gap-3">
            <span>
              {p.label} <span className="text-ink-faint">({p.section})</span>
            </span>
            <span className="font-mono text-ink">{i === 0 ? hm(p.ch) : signed(p.ch)}</span>
          </li>
        ))}
        <li className="flex justify-between gap-3 border-t border-hairline pt-0.5 font-medium text-ink">
          <span>Total CH</span>
          <span className="font-mono">{hm(total.total)}</span>
        </li>
      </ul>
      {total.fromVacationBank > 0 && (
        <p>{hm(total.fromVacationBank)} of it is trips your vacation takes off, paid from your vacation bank (7.G.1).</p>
      )}
      {!BLOCK_OVERRIDE_ON && total.blockOverrideEstimate > 0 && (
        <p className="text-ink-faint">
          Not counted: block override (4.FF). Some tools add up to 2:00 for each duty over 8 block hours, {hm(total.blockOverrideEstimate)} on this
          line, but we haven&rsquo;t confirmed how the contract works it out.
        </p>
      )}
      <p className="text-ink-faint">Worked out from the pack and the 2026 contract; your pay statement has the final say.</p>
    </div>
  );
}

/** Over the list while it's in pay-only order: what that means, and the way back. */
export function PayOrderBanner({ packId, averageBlg, rlg }: { packId: string; averageBlg: number | null; rlg: number | null }) {
  return (
    <section aria-label="Pay-only order" className="panel-glass mt-4 flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 print:hidden" data-pay-order>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">Pay-only order</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          Your list is ordered by Total CH, most first, and Copy and Send to VIPS bid it that way
          {averageBlg !== null ? `. A secondary line pays the ${hm(averageBlg)} average` : ""}
          {rlg !== null ? `, a reserve line ${hm(rlg)}` : ""}. Your own ranking is kept as it was.
        </p>
      </div>
      <Button variant="secondary" className="max-w-full px-3 py-1.5 text-xs" onClick={() => setPayOrder(packId, false)}>
        Back to your ranking
      </Button>
    </section>
  );
}
