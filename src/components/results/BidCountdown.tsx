"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { packBidClose, type BidCloseSource, type CalendarPack } from "@/lib/bid-calendar";
import { setBidDeadline, useBidDeadlineOverride } from "@/lib/bid-deadline-storage";

/*
 * Counts down to the close the pack itself prints on its bid calendar (or, from the December 2026 bid period,
 * the contract's rule counted from the pack's printed publication — see `lib/bid-calendar.ts`), unless the pilot
 * set their own. Never guessed from `BidPack.bidPeriodStart`, which is when the schedule starts, not when
 * bidding closes.
 */

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** This pack's bid close: the pilot's own, from this device's storage, else the pack's printed one. */
export function useBidDeadline(pack: CalendarPack) {
  // Watched rather than read once, so the calendar link and anything else showing it change with it.
  const own = useBidDeadlineOverride(pack.id);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // Only after mount is this device's storage read (the server and first paint can't): until then the time isn't known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(true);
  }, []);
  const fromPack = packBidClose(pack);
  const source: BidCloseSource | null = own ? "pilot" : (fromPack?.source ?? null);
  return {
    loaded,
    deadline: own ?? fromPack?.iso ?? null,
    source,
    /** The pack's own close, shown in the editor so a change is made knowingly. */
    packClose: fromPack,
    save(iso: string) {
      setBidDeadline(pack.id, iso);
    },
    /** Back to the pack's time (or to none, when the pack has no calendar). */
    clear() {
      setBidDeadline(pack.id, null);
    },
  };
}

/** A few words on where the countdown's time came from. */
export function bidCloseSourceLabel(source: BidCloseSource | null): string | null {
  if (source === "pack") return "From your bid pack's calendar";
  if (source === "contract") return "From the 2026 contract's close rule (25.C.4), counted from the pack's publication";
  if (source === "pilot") return "The time you set";
  return null;
}

export type Urgency = "calm" | "soon" | "today" | "imminent" | "closed";

/** How close the deadline is, in the bands the readout colors by. */
export function urgencyFor(msLeft: number): Urgency {
  if (msLeft <= 0) return "closed";
  if (msLeft <= 6 * 3_600_000) return "imminent";
  if (msLeft <= 24 * 3_600_000) return "today";
  if (msLeft <= 72 * 3_600_000) return "soon";
  return "calm";
}

/**
 * The time left, live. Ticks every second once it's inside two days — the
 * stretch where a pilot actually watches it — and every 30 seconds before
 * that, when seconds would only be noise.
 */
export function useTimeLeft(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const msLeft = deadline ? new Date(deadline).getTime() - now : null;
  const fast = msLeft !== null && msLeft > 0 && msLeft <= 48 * 3_600_000;
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [deadline, fast]);
  return msLeft;
}

export function formatTimeLeft(msLeft: number): { main: string; seconds: string | null } {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (msLeft > 48 * 3_600_000) return { main: `${days}d ${pad(hours)}h ${pad(minutes)}m`, seconds: null };
  return { main: `${pad(days * 24 + hours)}:${pad(minutes)}`, seconds: pad(seconds) };
}

/** Setting (or changing, or clearing) the deadline — the pack's own time unless the pilot knows of a different one. */
export function BidDeadlineEditor({
  deadline,
  ownSet,
  packClose,
  onSave,
  onClear,
  onDone,
}: {
  deadline: string | null;
  /** True when the pilot set the time themselves (so "use the pack's time" can undo it). */
  ownSet: boolean;
  packClose: { iso: string; source: BidCloseSource } | null;
  onSave: (iso: string) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(deadline ? toLocalInputValue(deadline) : "");
  return (
    <div>
      <label className="block text-sm font-medium text-ink" htmlFor="bid-deadline-input">
        When does bidding close for you?
      </label>
      <p className="mt-1 text-xs text-ink-muted">
        {packClose
          ? `Your bid pack says ${new Date(packClose.iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Change it only if FedEx has announced a different time.`
          : "Your bid pack doesn't print a close time this app can read — enter the one FedEx gives for your seat."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id="bid-deadline-input"
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-md border border-hairline bg-canvas/60 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <Button
          type="button"
          onClick={() => {
            if (!draft) return;
            onSave(new Date(draft).toISOString());
            onDone();
          }}
          disabled={!draft}
        >
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {deadline && ownSet && (
          <button
            type="button"
            onClick={() => {
              onClear();
              onDone();
            }}
            className="text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            {packClose ? "Use the pack's time" : "Clear"}
          </button>
        )}
      </div>
    </div>
  );
}
