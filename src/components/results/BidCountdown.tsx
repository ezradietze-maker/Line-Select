"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getBidDeadline, setBidDeadline } from "@/lib/bid-deadline-storage";

/*
 * Counts down to a date the PILOT typed in, never one this app guessed —
 * `BidPack.bidPeriodStart` is when the schedule period begins, not when
 * bidding itself closes, and treating those as the same date would risk
 * stating the wrong real deadline for something that actually matters.
 */

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The pilot's own bid deadline for this pack, from this device's storage. */
export function useBidDeadline(bidPackId: string) {
  const [loaded, setLoaded] = useState(false);
  const [deadline, setDeadline] = useState<string | null>(null);
  useEffect(() => {
    // One-time load of a value that lives outside React's own state (localStorage) — not derived from props, so there's no cascading-render concern despite the lint rule's default suspicion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeadline(getBidDeadline(bidPackId));
    setLoaded(true);
  }, [bidPackId]);
  return {
    loaded,
    deadline,
    save(iso: string) {
      setBidDeadline(bidPackId, iso);
      setDeadline(iso);
    },
    clear() {
      setBidDeadline(bidPackId, null);
      setDeadline(null);
    },
  };
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

/** Setting (or changing, or clearing) the deadline — whatever the pilot's base prints, typed in by them. */
export function BidDeadlineEditor({
  deadline,
  onSave,
  onClear,
  onDone,
}: {
  deadline: string | null;
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
        Whatever your base actually prints for this bid period &mdash; this is only what you type here, never guessed.
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
        {deadline && (
          <button
            type="button"
            onClick={() => {
              onClear();
              onDone();
            }}
            className="text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
