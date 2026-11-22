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
export function VacationGainNote({ line, placement, goal = false, className = "mt-0.5 px-3" }: { line: LineVacationOptions | undefined; placement: VacationPlacement | undefined; goal?: boolean; className?: string }) {
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
      <p className={`${className} text-xs text-ink-muted`} data-vacation-stuck>
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
    <p className={`${className} text-xs font-medium text-accent`} data-vacation-gain>
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
  bare = false,
}: {
  line: LineVacationOptions | undefined;
  placement: VacationPlacement | undefined;
  overridden: boolean;
  onPlace: (placement: VacationPlacement) => void;
  onReset: () => void;
  /** Inside "Your vacation on this line", which is its frame. */
  bare?: boolean;
}) {
  if (!line || line.options.length < 2) return null;
  const current = optionAt(line, placement) ?? line.options[0];
  const ids = Object.keys(current.placement.offsets);
  return (
    <div className={`space-y-1 text-xs text-ink ${bare ? "mt-2 border-t border-accent/30 pt-2" : "mt-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2"}`} data-vacation-control>
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
            <span className="font-medium">{ids.length > 1 ? `Slide vacation ${n + 1}` : bare ? "Slide it" : "Your vacation on this line"}{ids.length > 1 && !bare ? " on this line" : ""}:</span>
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

/**
 * In an opened line, everything the pilot's vacation does on it, in one place (it used to sit under every line in the
 * list): what it takes off and why (`reason`, from `flyVacationsOnLine`, free time a long trip needs included), what the
 * goal's slide gains against where the pack has it or why no slide helps, and the ◀▶ to step it here.
 */
export function VacationOnLine({
  reason,
  line,
  placement,
  goal,
  overridden,
  onPlace,
  onReset,
  bare = false,
}: {
  /** Inside the opened line's Vacation drop-down, which names it: no heading of its own, nor the margins beside it. */
  bare?: boolean;
  reason: string | null | undefined;
  line: LineVacationOptions | undefined;
  placement: VacationPlacement | undefined;
  goal: boolean;
  overridden: boolean;
  onPlace: (placement: VacationPlacement) => void;
  onReset: () => void;
}) {
  if (!reason && !(line && line.options.length > 1)) return null;
  return (
    <section aria-label="Your vacation on this line" data-vacation-on-line className={`rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5 ${bare ? "" : "mx-5 my-3 sm:mx-6"}`}>
      {!bare && <p className="text-2xs font-medium text-accent">Your vacation on this line</p>}
      {reason && <p className={`${bare ? "" : "mt-1 "}text-xs text-ink`}>{reason}</p>}
      <VacationGainNote line={line} placement={placement} goal={goal} className="mt-1" />
      <VacationLineControl bare line={line} placement={placement} overridden={overridden} onPlace={onPlace} onReset={onReset} />
    </section>
  );
}

/**
 * The Vacation drop-down's few words, closed: where it is on this line (slid, or where the pack has it) and what it
 * takes off, and whether there's anywhere else to slide it.
 */
export function vacationHint(removedTrips: number, placement: VacationPlacement | undefined, canSlide: boolean): string {
  const moved = Object.values(placement?.offsets ?? {}).find((o) => o !== 0);
  const where = moved ? `slid ${Math.abs(moved)} day${Math.abs(moved) === 1 ? "" : "s"} ${moved > 0 ? "later" : "earlier"}` : "where the pack has it";
  const takes = removedTrips ? `takes off ${removedTrips} trip${removedTrips === 1 ? "" : "s"}` : "takes off no trips";
  return [where, takes, canSlide ? "slide it" : null].filter(Boolean).join(" · ");
}
