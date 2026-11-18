"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { bidTimeline, type TimelineEvent, type TimelinePack } from "@/lib/bid-timeline";
import { useBidDeadlineOverride } from "@/lib/use-bid-deadline";
import { ChevronDownIcon } from "@/components/ui/icons";

/** The clock, to the half minute: enough for "in 2d 4h", and the server and first paint (which can't know it) show none. */
const TICK = 30_000;
function subscribeClock(onChange: () => void) {
  const id = window.setInterval(onChange, TICK);
  return () => window.clearInterval(id);
}
const useNow = () => useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / TICK) * TICK, () => null);

/** "in 2d 4h", "in 3h 20m", "in 12m". */
export function timeUntil(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

/** Open time and secondary lines are set in the base's own time; every other window in Memphis (Central) time. */
const LOCAL_KINDS = new Set<TimelineEvent["kind"]>(["open-time", "secondary-lines"]);

/** When an event falls, in the clock its rule uses: "Sat Nov 21, 07:00 CT", or "Thu Nov 26, 22:00 ANC". */
export function eventWhen(e: Pick<TimelineEvent, "at" | "kind">, base: string): string {
  const local = LOCAL_KINDS.has(e.kind);
  const zone = local ? (timezoneForAirport(base) ?? "America/Chicago") : "America/Chicago";
  return `${DateTime.fromISO(e.at, { zone: "utc" }).setZone(zone).toFormat("ccc LLL d, HH:mm")} ${local ? base : "CT"}`;
}

const SOURCE: Record<TimelineEvent["source"], string> = {
  pack: "From your pack",
  pilot: "Your time",
  contract: "Contract",
  estimated: "Estimated",
};

/** This bid's dates for the pilot's seat, in order, without the bid month on each (the strip names it once). */
export function bidWeekEvents(pack: TimelinePack, pilotClose: string | null): TimelineEvent[] {
  return bidTimeline(pack, pilotClose).filter((e) => e.bidMonth === pack.month);
}

const withoutMonth = (e: TimelineEvent) => e.label.replace(new RegExp(`^${e.bidMonth}\\s+`), "").replace(/^\w/, (c) => c.toUpperCase());

/**
 * The bid week at a glance: what's next and how long until it, opening to every date for this seat — bid close, awards,
 * the conflict window, View/Add, the SWW, secondary lines and open time — each with where its time comes from.
 */
export function BidWeek({ pack, className = "" }: { pack: TimelinePack & { id: string }; className?: string }) {
  const pilotClose = useBidDeadlineOverride(pack.id);
  const events = useMemo(() => bidWeekEvents(pack, pilotClose), [pack, pilotClose]);
  const now = useNow();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (events.length === 0) return null;
  const next = now === null ? null : events.find((e) => Date.parse(e.at) > now);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left text-sm"
      >
        <span className="text-2xs font-medium text-ink-faint">{pack.month} bid week</span>
        {now === null ? (
          <span className="text-ink-muted">&nbsp;</span>
        ) : next ? (
          <>
            <span className="font-medium text-ink">Next: {withoutMonth(next)}</span>
            <span className="font-mono text-xs tabular-nums text-accent">{timeUntil(Date.parse(next.at) - now)}</span>
            <span className="text-xs text-ink-muted">{eventWhen(next, pack.base)}</span>
          </>
        ) : (
          <span className="text-ink-muted">Every date for this bid has passed.</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint">
          {open ? "Hide the week" : "Show the week"}
          <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <ol id={listId} className="mt-3 divide-y divide-hairline rounded-md border border-hairline">
          {events.map((e) => {
            const past = now !== null && Date.parse(e.at) <= now;
            const isNext = e === next;
            return (
              <li key={`${e.kind}-${e.at}`} className={`grid gap-x-3 gap-y-0.5 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] ${past ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <span className={isNext ? "font-semibold text-ink" : "text-ink"}>{withoutMonth(e)}</span>
                  {isNext && <span className="ml-2 rounded-[2px] border border-accent/50 px-1 py-px text-2xs font-medium text-accent">Next</span>}
                  <span className="block text-xs text-ink-faint">
                    {SOURCE[e.source]} &middot; {e.basis}
                  </span>
                </div>
                <div className="font-mono text-xs tabular-nums text-ink-muted sm:text-right">
                  {eventWhen(e, pack.base)}
                  {!past && now !== null && <span className="block text-ink-faint">{timeUntil(Date.parse(e.at) - now)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
