"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { zoneOf } from "@/lib/phase-in";
import type { CarryIn } from "@/lib/use-carry-in";
import { aimLabel } from "@/lib/vacation-goal";
import { vacationLabel } from "@/lib/vacation-slide";
import type { BidPack } from "@/types/bidpack";

export interface MonthTab {
  id: string;
  label: string;
  /** A few words on where it stands: "Oct 1 to Oct 15 · fly the most · slid on 69". */
  summary: string;
  /** Something needs the pilot (a number, a line over a limit): marked on the tab, and said in `summary`. */
  attention?: boolean;
  content: ReactNode;
}

/** Which drawer the pilot left open, on this device. */
const OPEN_KEY = "line-select:your-month-open:v1";
function readOpen(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(OPEN_KEY);
  } catch {
    return null;
  }
}

/**
 * "Your month", above the list: what changes how this month's lines fly — the vacation, what carries in, the flight-time
 * limits — as one row of tabs, each with where it stands in a few words, and one drawer open at a time below it. Each
 * drawer holds that panel whole; a problem that needs the pilot shows on its tab with the drawer closed.
 */
export function YourMonth({ tabs }: { tabs: MonthTab[] }) {
  const [openId, setOpenId] = useState(readOpen);
  const open = tabs.find((t) => t.id === openId) ?? null;
  if (!tabs.length) return null;
  const choose = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    try {
      if (next) window.localStorage.setItem(OPEN_KEY, next);
      else window.localStorage.removeItem(OPEN_KEY);
    } catch {
      // storage unavailable — kept for this visit only
    }
  };
  return (
    <section aria-label="Your month" className="panel-glass mt-3 print:hidden" data-your-month>
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 sm:px-3">
        <span className="px-1 text-2xs font-medium text-ink-faint">Your month</span>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => choose(t.id)}
            aria-expanded={open?.id === t.id}
            aria-controls={`month-drawer-${t.id}`}
            data-month-tab={t.id}
            className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-left text-sm transition-colors ${
              open?.id === t.id ? "border-accent bg-accent/10 text-ink" : t.attention ? "border-warn/60 text-ink hover:border-warn" : "border-hairline text-ink hover:border-border-strong"
            }`}
          >
            {t.attention && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
            <span className="font-medium">{t.label}</span>
            <span className={`truncate ${t.attention ? "text-warn" : "text-ink-muted"}`}>{t.summary}</span>
            <ChevronDownIcon className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${open?.id === t.id ? "rotate-180" : ""}`} />
          </button>
        ))}
      </div>
      {open && (
        <div id={`month-drawer-${open.id}`} className="animate-fade-in border-t border-hairline px-4 py-4 sm:px-5">
          {open.content}
        </div>
      )}
    </section>
  );
}

/** The vacation in a few words: its dates, how it's used, the goal it slides for, and how many lines it slid on. */
export function vacationSummary(pack: BidPack, carry: CarryIn, moved: number | null): { text: string; attention: boolean } {
  const { status } = carry.vacations;
  if (status === "no-number" || status === "band") return { text: "needs your seniority number", attention: true };
  if (status === "not-listed") return { text: "your number isn't on this pack's list", attention: true };
  if (status === "no-schedule") return { text: "not in this pack · type it", attention: false };
  if (status === "none") return { text: "none this month", attention: false };
  const zone = zoneOf(pack);
  const active = carry.chosen.filter((v) => v.choice !== "not-taking");
  if (!active.length) return { text: "not taking it", attention: false };
  // "Oct 1 to Oct 15 (15 days)" → "Oct 1 to Oct 15".
  const dates = active.map((v) => vacationLabel(v.vacation, zone).replace(/ \(.*\)$/, "")).join(", ");
  const parts = [dates];
  if (active.some((v) => v.choice === "keep-flying")) parts.push("keep flying");
  const aim = carry.state.vacationGoal?.aims[0];
  // "Fly the most: keep your vacation bank" → "fly the most".
  if (aim) parts.push(aimLabel(aim).split(":")[0].replace(/^./, (c) => c.toLowerCase()));
  if (aim && moved !== null) parts.push(moved ? `slid on ${moved}` : "best where it is");
  return { text: parts.join(" · "), attention: false };
}

/** What carries in, in a few words. */
export function carrySummary(carry: CarryIn): string {
  const n = carry.state.items.length;
  return n ? `${n} carried in` : carry.state.none ? "None" : "Not set";
}
