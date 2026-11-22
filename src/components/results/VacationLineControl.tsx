"use client";

import { formatHoursValue as hm } from "@/lib/interview-config";
import type { LineVacationOptions, VacationOption } from "@/lib/vacation-engine";
import type { VacationPlacement } from "@/lib/vacation-lines";

const said = (offset: number) => (offset === 0 ? "where the pack has it" : `slid ${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} ${offset > 0 ? "later" : "earlier"}`);

/** The option a placement is on this line: the same offsets, and the same waiver. */
export function optionAt(line: LineVacationOptions, placement: VacationPlacement | undefined): VacationOption | null {
  const want = (id: string) => placement?.offsets[id] ?? 0;
  return line.options.find((o) => Object.keys(o.placement.offsets).every((id) => o.placement.offsets[id] === want(id)) && !!o.placement.waiveFrontBuffer === !!placement?.waiveFrontBuffer) ?? null;
}

/**
 * Under a line whose vacation the goal (or the pilot) moved: what that gains against where the pack has it, in the terms
 * a pilot weighs. Nothing for a line it leaves where it was.
 */
export function VacationGainNote({ line, placement, goal = false }: { line: LineVacationOptions | undefined; placement: VacationPlacement | undefined; goal?: boolean }) {
  // A line the goal leaves where the pack has it has no placement of its own.
  if (!line || (!placement && !goal)) return null;
  const awarded = line.options[0];
  const at = optionAt(line, placement);
  if (!awarded || !at) return null;
  if (at === awarded) {
    // Left where the pack has it, still taking trips off: say when no slide could keep them, or it looked like the goal
    // was ignored (a pilot who wants to fly the most, watching long trips come off).
    const stuck = awarded.removedPairings.filter((p) => line.options.every((o) => o.removedPairings.includes(p)));
    if (line.options.length < 2 || !stuck.length) return null;
    const trips = stuck.map((p) => `trip ${p}`).join(" and ");
    return (
      <p className="mt-0.5 px-3 text-xs text-ink-muted" data-vacation-stuck>
        {trips[0].toUpperCase() + trips.slice(1)} {stuck.length === 1 ? "is" : "are"} under your vacation wherever it can slide on this line (up to 5 days either
        way), so no slide keeps {stuck.length === 1 ? "it" : "them"}.
      </p>
    );
  }
  const parts: string[] = [];
  const days = at.daysOff - awarded.daysOff;
  if (days) parts.push(`${days > 0 ? "+" : "−"}${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} off`);
  const bank = at.bankCH - awarded.bankCH;
  if (Math.abs(bank) >= 1 / 60) parts.push(`${bank > 0 ? "+" : "−"}${hm(Math.abs(bank))} CH ${bank > 0 ? "more" : "less"} from your bank`);
  const run = (at.longestOff ?? 0) - (awarded.longestOff ?? 0);
  if (run) parts.push(`longest stretch ${run > 0 ? "+" : "−"}${Math.abs(run)}`);
  if (at.waived) parts.push("a trip kept by waiving the 24 hours free before it");
  return (
    <p className="mt-0.5 px-3 text-xs font-medium text-accent" data-vacation-gain>
      Against where the pack has it: {parts.length ? parts.join(", ") : "the same days off and bank, on other days"}.
    </p>
  );
}

/**
 * In an opened line: the pilot's own hand on this line's vacation. A step earlier or later through its legal spots
 * here (each vacation, when there are two), and back to the goal's choice. What's kept is this line's alone.
 */
export function VacationLineControl({
  line,
  placement,
  overridden,
  onPlace,
  onReset,
}: {
  line: LineVacationOptions | undefined;
  placement: VacationPlacement | undefined;
  overridden: boolean;
  onPlace: (placement: VacationPlacement) => void;
  onReset: () => void;
}) {
  if (!line || line.options.length < 2) return null;
  const current = optionAt(line, placement) ?? line.options[0];
  const ids = Object.keys(current.placement.offsets);
  return (
    <div className="mt-2 space-y-1 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-ink" data-vacation-control>
      {ids.map((id, n) => {
        const offset = current.placement.offsets[id];
        // The legal spots for this vacation with the other where it is now.
        const legal = line.options
          .filter((o) => !o.waived && Object.keys(o.placement.offsets).every((k) => k === id || o.placement.offsets[k] === current.placement.offsets[k]))
          .map((o) => o.placement.offsets[id])
          .sort((a, b) => a - b);
        const earlier = [...legal].reverse().find((o) => o < offset);
        const later = legal.find((o) => o > offset);
        const step = (to: number | undefined) => to !== undefined && onPlace({ offsets: { ...current.placement.offsets, [id]: to } });
        return (
          <div key={id} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{ids.length > 1 ? `Vacation ${n + 1}` : "Your vacation"} on this line:</span>
            <button type="button" className="rounded border border-hairline px-1.5 disabled:opacity-40" disabled={earlier === undefined} onClick={() => step(earlier)} aria-label="A day earlier">
              ◀
            </button>
            <span className="tabular-nums">{said(offset)}</span>
            <button type="button" className="rounded border border-hairline px-1.5 disabled:opacity-40" disabled={later === undefined} onClick={() => step(later)} aria-label="A day later">
              ▶
            </button>
          </div>
        );
      })}
      <p className="text-ink-muted">
        {current.daysOff} days off, {hm(current.bankCH)} CH from your bank.{" "}
        {overridden && (
          <button type="button" className="font-medium text-brand underline underline-offset-2" onClick={onReset}>
            Back to your goal&rsquo;s choice
          </button>
        )}
      </p>
    </div>
  );
}
