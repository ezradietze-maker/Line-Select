"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getBidDeadline, setBidDeadline } from "@/lib/bid-deadline-storage";

interface BidCountdownProps {
  bidPackId: string;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Segment({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 font-mono text-xl font-semibold tabular-nums text-ink shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)] sm:text-2xl">
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

/**
 * Counts down to a date the PILOT typed in, never one this app guessed —
 * `BidPack.bidPeriodStart` is when the schedule period begins, not when
 * bidding itself closes, and treating those as the same date would risk
 * stating the wrong real deadline for something that actually matters.
 */
export function BidCountdown({ bidPackId }: BidCountdownProps) {
  const [loaded, setLoaded] = useState(false);
  const [deadline, setDeadlineState] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    // One-time load of a value that lives outside React's own state (localStorage) — not derived from props, so there's no cascading-render concern despite the lint rule's default suspicion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeadlineState(getBidDeadline(bidPackId));
    setNow(Date.now());
    setLoaded(true);
  }, [bidPackId]);

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!loaded) return null;

  function startEditing() {
    setDraft(deadline ? toLocalInputValue(deadline) : "");
    setEditing(true);
  }

  function save() {
    if (!draft) return;
    const iso = new Date(draft).toISOString();
    setBidDeadline(bidPackId, iso);
    setDeadlineState(iso);
    setNow(Date.now());
    setEditing(false);
  }

  function clear() {
    setBidDeadline(bidPackId, null);
    setDeadlineState(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated sm:p-5">
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
            className="rounded-md border border-border-strong bg-canvas px-3 py-2 text-sm text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <Button type="button" onClick={save} disabled={!draft}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          {deadline && (
            <button type="button" onClick={clear} className="text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
              Clear
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!deadline) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface p-4">
        <p className="text-sm text-ink-muted">Know when bidding actually closes? Set it and get a live countdown.</p>
        <Button type="button" variant="secondary" onClick={startEditing} className="shrink-0">
          Set bid close time
        </Button>
      </div>
    );
  }

  const diffMs = new Date(deadline).getTime() - now;

  if (diffMs <= 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-elevated">
        <p className="text-sm font-medium text-ink">Bidding closed {new Date(deadline).toLocaleString()}.</p>
        <button type="button" onClick={startEditing} className="shrink-0 text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
          Set a new one
        </button>
      </div>
    );
  }

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Bidding closes</div>
        <button type="button" onClick={startEditing} className="text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
          Change
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Segment value={String(days)} label={days === 1 ? "Day" : "Days"} />
        <span className="mb-4 font-mono text-lg text-ink-faint">:</span>
        <Segment value={String(hours).padStart(2, "0")} label="Hours" />
        <span className="mb-4 font-mono text-lg text-ink-faint">:</span>
        <Segment value={String(minutes).padStart(2, "0")} label="Min" />
      </div>
    </div>
  );
}
