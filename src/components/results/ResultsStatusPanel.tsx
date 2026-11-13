"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BidDeadlineEditor, bidCloseSourceLabel, formatTimeLeft, urgencyFor, useBidDeadline, useTimeLeft, type Urgency } from "@/components/results/BidCountdown";
import { BidPeriodChangeBanner } from "@/components/results/BidPeriodChangeBanner";
import { ForecastBanner } from "@/components/results/ForecastBanner";
import { PilotProfileSummary } from "@/components/results/PilotProfileSummary";
import { Button } from "@/components/ui/Button";
import { FlipText } from "@/components/ui/FlipText";
import { CalendarIcon, ChevronDownIcon, PlaneIcon } from "@/components/ui/icons";
import { bidChecklist, upcomingReminders, withBidEntered } from "@/lib/bid-checklist";
import { buildDeadlineReminderIcs } from "@/lib/ics-export";
import type { BidPeriodChangeSummary } from "@/lib/bid-period-history";
import type { ProfileRichness } from "@/lib/interview-engine";
import type { BidForecast } from "@/lib/forecast/forecast";
import type { ForecastResponse } from "@/lib/forecast/forecast-client";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

type DrawerId = "deadline" | "chances" | "profile" | "since";

const URGENCY_TEXT: Record<Urgency, string> = {
  calm: "text-readout",
  soon: "text-accent",
  today: "text-warn",
  imminent: "text-danger",
  closed: "text-ink-muted",
};

const LABEL = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint";

/** A tick in a circle: filled when the step's done. */
/** No date set yet: a departures board's tiles standing blank, waiting for a time to turn over to. */
function EmptyBoard() {
  return (
    <span role="img" className="inline-flex gap-[3px] align-middle" aria-label="No date set">
      {[..."--:--"].map((ch, i) =>
        ch === ":" ? (
          <span key={i} aria-hidden className="px-px text-ink-faint/50">
            :
          </span>
        ) : (
          <span key={i} aria-hidden className="relative inline-flex h-[1.2em] w-[0.8em] items-center justify-center rounded-[4px] bg-ink/[0.07] text-ink-faint/60">
            {ch}
            <span className="absolute inset-x-0 top-1/2 h-px bg-canvas/70" />
          </span>
        )
      )}
    </span>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${done ? "border-good bg-good text-canvas" : "border-border-strong bg-canvas/60"}`}
    >
      {done && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-3 w-3">
          {/* Drawn in, the way a pen ticks a box. */}
          <path className="tick-draw" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

/** One of the panel's quieter readouts: a label and its value, opening the detail underneath. */
function Readout({ id, label, value, open, onToggle, tone = "text-ink" }: { id: DrawerId; label: string; value: ReactNode; open: boolean; onToggle: (id: DrawerId) => void; tone?: string }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      aria-expanded={open}
      aria-controls={`status-drawer-${id}`}
      className={`inline-flex items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-ink/[0.05] ${open ? "bg-ink/[0.05]" : ""}`}
    >
      <span className="text-ink-muted">{label}</span>
      <span className={`font-medium ${tone}`}>{value}</span>
      <ChevronDownIcon className={`h-3 w-3 self-center text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** Android Chrome refuses `new Notification()` from a page; it only shows one through the service worker, when there is one. */
function notify(title: string, options: NotificationOptions) {
  const direct = () => {
    try {
      new Notification(title, options);
    } catch {
      // No way to show one here.
    }
  };
  if (!("serviceWorker" in navigator)) return direct();
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, options) : direct()))
    .catch(direct);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Remembered for this visit only.
  }
}

/** Reminders while Line Select is open: the browser's own notifications, the day before and an hour before. */
function useInTabReminders(packId: string, deadline: string | null, label: string) {
  const key = `line-select:bid-reminders:v1:${packId}`;
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    // Read once from this device's storage — outside React's own state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" && readStorage(key) === "on");
  }, [key]);
  useEffect(() => {
    if (!enabled || !deadline) return;
    const timers = upcomingReminders(deadline).map((r) => window.setTimeout(() => notify(r.text, { body: label, tag: `bid-${packId}-${r.text}` }), r.inMs));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [enabled, deadline, label, packId]);
  const supported = typeof window !== "undefined" && "Notification" in window;
  async function toggle() {
    if (!supported) return;
    if (enabled) {
      writeStorage(key, "off");
      setEnabled(false);
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      setBlocked(true);
      return;
    }
    // Allowed since (in the browser's site settings): the earlier "blocked" no longer holds.
    setBlocked(false);
    writeStorage(key, "on");
    setEnabled(true);
  }
  return { supported, enabled, blocked, toggle };
}

interface ResultsStatusPanelProps {
  pack: Pick<BidPack, "id" | "base" | "aircraft" | "seat" | "month" | "bidCalendar">;
  profile: PreferenceProfile;
  onUpdateProfile: (profile: PreferenceProfile) => void;
  confidenceLevel: ProfileRichness["level"] | null;
  onEditPreferences: () => void;
  bidPeriodChange: BidPeriodChangeSummary | null;
  forecast: {
    hasList: boolean;
    forecast: BidForecast | null;
    response: ForecastResponse | null;
    loading: boolean;
    failed: boolean;
    realisticCount: number;
    showingRealistic: boolean;
    onToggleRealistic: () => void;
    canShare: boolean;
    sharing: boolean;
    onSharingChange: (next: boolean) => void;
  };
}

/**
 * This month's bid, above the first line: when bidding closes (the pilot's own date, counted down, with reminders),
 * the bid's steps ticked off as they're done, and the quieter readouts — your chances, your profile, what changed
 * since last month — each opening its detail underneath. The ranking itself isn't pushed below the fold.
 */
export function ResultsStatusPanel({
  pack,
  profile,
  onUpdateProfile,
  confidenceLevel,
  onEditPreferences,
  bidPeriodChange,
  forecast: f,
}: ResultsStatusPanelProps) {
  const [open, setOpen] = useState<DrawerId | null>(null);
  const toggle = (id: DrawerId) => setOpen((cur) => (cur === id ? null : id));
  const deadline = useBidDeadline(pack);
  const msLeft = useTimeLeft(deadline.deadline);
  const urgency = msLeft === null ? null : urgencyFor(msLeft);
  const finalCall = urgency === "today" || urgency === "imminent";
  const time = msLeft !== null && msLeft > 0 ? formatTimeLeft(msLeft) : null;
  const packLabel = `${pack.base} ${pack.aircraft} ${pack.seat} ${pack.month}`;
  const reminders = useInTabReminders(pack.id, deadline.deadline, packLabel);
  const items = bidChecklist(profile, pack);
  const doneCount = items.filter((i) => i.done).length;
  // Cleared to bid: every step before the award is done (the award can only be logged once it's out). The takeoff
  // plays when that happens here, not on every visit to a finished checklist.
  const cleared = items.every((i) => i.done || i.id === "award");
  const awarded = items.some((i) => i.id === "award" && i.done);
  const [takeoff, setTakeoff] = useState(false);
  const [wasCleared, setWasCleared] = useState(cleared);
  if (cleared !== wasCleared) {
    setWasCleared(cleared);
    setTakeoff(cleared);
  }

  const inYourWords = profile.discoveredFacts.filter((x) => x.kind === "qualitative").length;
  const depth =
    confidenceLevel === "thorough" ? "Thorough" : confidenceLevel === "moderate" ? "Moderate" : confidenceLevel === "thin" ? "Short" : profile.deepRoundCompleted ? "Deep" : "Set";

  function downloadReminders() {
    if (!deadline.deadline) return;
    const blob = new Blob([buildDeadlineReminderIcs(pack.id, deadline.deadline, packLabel)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bid-closes-${pack.month.toLowerCase()}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="This month's bid" className="panel-glass mt-5 p-4 sm:p-5 print:hidden">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:gap-6">
        {/* When bidding closes — there from the first frame (it reads its saved time a moment later), so nothing below shifts. */}
        <div className="min-w-0">
          <div className={`flex items-center gap-2 ${LABEL}`}>
            Bid closes
            {urgency === "imminent" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger shadow-[0_0_6px_var(--color-danger)]" aria-hidden />}
            {/* Inside the last day: final call, and the countdown glows (the tab's title counts down too). */}
            {finalCall && <span className={`drop-in rounded-full border px-1.5 py-px ${urgency === "imminent" ? "border-danger/50 text-danger" : "border-accent/50 text-accent"}`}>Final call</span>}
          </div>
          <div className={`mt-1 font-mono text-3xl font-semibold tabular-nums sm:text-[2rem] ${urgency ? URGENCY_TEXT[urgency] : "text-ink-faint"} ${finalCall ? "final-call" : ""}`}>
            {time ? (
              <>
                {/* Digits turn over like a departures board as they change. */}
                <FlipText text={time.main} />
                {time.seconds && (
                  <span className="text-[0.7em] opacity-70">
                    :<FlipText text={time.seconds} />
                  </span>
                )}
              </>
            ) : urgency === "closed" ? (
              "Closed"
            ) : deadline.loaded ? (
              <EmptyBoard />
            ) : (
              "—"
            )}
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {!deadline.loaded
              ? "\u00a0"
              : deadline.deadline
                ? new Date(deadline.deadline).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                : "Set when bidding closes for a live countdown."}
            {deadline.loaded && deadline.deadline && bidCloseSourceLabel(deadline.source) && (
              <span className="mt-0.5 block text-xs text-ink-faint">
                {bidCloseSourceLabel(deadline.source)} &middot;{" "}
                {new Date(deadline.deadline).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="!px-3 !py-1.5 text-sm" onClick={() => toggle("deadline")} aria-expanded={open === "deadline"}>
              {deadline.deadline ? (urgency === "closed" ? "Set a new date" : "Change") : "Set the date"}
            </Button>
            {deadline.deadline && urgency !== "closed" && (
              <>
                <Button variant="ghost" className="!px-3 !py-1.5 text-sm" onClick={downloadReminders} title="A calendar event with alarms the day before and an hour before — your phone reminds you, whether or not Line Select is open">
                  <CalendarIcon className="mr-1.5 h-4 w-4" />
                  Remind me in my calendar
                </Button>
                {reminders.supported && (
                  <label className="inline-flex cursor-pointer items-center gap-2 px-1 text-sm text-ink-muted">
                    <input type="checkbox" checked={reminders.enabled} onChange={reminders.toggle} className="h-4 w-4 accent-[var(--color-accent)]" />
                    Remind me here
                  </label>
                )}
              </>
            )}
          </div>
          {reminders.enabled && <p className="mt-1.5 text-xs text-ink-faint">The day before and an hour before, while Line Select is open in a tab.</p>}
          {reminders.blocked && <p className="mt-1.5 text-xs text-warn">Notifications are blocked for this site in your browser&rsquo;s settings &mdash; the calendar reminder works either way.</p>}
        </div>

        {/* The bid's steps. */}
        <div className="min-w-0 md:border-l md:border-hairline md:pl-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>This month&rsquo;s bid</span>
            <span className="text-xs text-ink-muted tabular-nums">
              {doneCount} of {items.length} done
            </span>
          </div>
          <div className="relative mt-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.08]" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={doneCount} aria-label="Bid steps done">
              <div className="h-full rounded-full bg-good transition-[width] duration-500" style={{ width: `${(doneCount / items.length) * 100}%` }} />
            </div>
            {/* Cleared to bid: a plane rolls down the bar and climbs away — once, when it happens. */}
            {takeoff && (
              <span aria-hidden className="takeoff pointer-events-none absolute top-1/2 text-good">
                <PlaneIcon className="h-4 w-4 rotate-45" />
              </span>
            )}
          </div>
          {cleared && !awarded && <p className="drop-in mt-1.5 text-xs font-medium text-good">Cleared to bid &mdash; good luck this month.</p>}
          <ul className="mt-3 space-y-1">
            {items.map((item) => (
              <li key={item.id}>
                {item.manual ? (
                  <button
                    type="button"
                    onClick={() => onUpdateProfile(withBidEntered(profile, pack.id, !item.done))}
                    aria-pressed={item.done}
                    className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-ink/[0.05]"
                  >
                    <Tick done={item.done} />
                    <span className={item.done ? "text-ink" : "text-ink"}>{item.label}</span>
                    {!item.done && <span className="ml-auto hidden text-xs text-ink-faint sm:inline">Tick when done</span>}
                  </button>
                ) : (
                  <div className="flex items-center gap-2.5 px-1.5 py-1.5 text-sm">
                    <Tick done={item.done} />
                    <span className={item.done ? "text-ink" : "text-ink-muted"}>{item.label}</span>
                    {item.id === "interview" && !item.done && (
                      <button type="button" onClick={onEditPreferences} className="ml-auto text-xs font-medium text-accent underline decoration-dotted underline-offset-4">
                        Start it
                      </button>
                    )}
                    {item.id === "award" && (
                      <Link href="/logbook" className="ml-auto text-xs font-medium text-accent underline decoration-dotted underline-offset-4">
                        {item.done ? "Logbook" : "Log it after the award"}
                      </Link>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3">
        {f.hasList && (
          <Readout
            id="chances"
            label="Your chances"
            open={open === "chances"}
            onToggle={toggle}
            tone={!profile.seniorityNumber ? "text-ink-faint" : "text-ink"}
            value={!profile.seniorityNumber ? "add your seniority" : f.forecast ? `${f.realisticCount} lines you could hold` : f.failed ? "couldn’t estimate" : "estimating…"}
          />
        )}
        <Readout id="profile" label="Your profile" open={open === "profile"} onToggle={toggle} tone={confidenceLevel === "thin" ? "text-warn" : "text-ink"} value={inYourWords > 0 ? `${depth} · ${inYourWords} in your words` : depth} />
        {bidPeriodChange && (
          <Readout id="since" label={`Since ${bidPeriodChange.previousMonth}`} open={open === "since"} onToggle={toggle} value={`${bidPeriodChange.sameTopLine ? "same #1" : "new #1"}, line ${bidPeriodChange.currentTopLine}`} />
        )}
      </div>
      {open && (
        <div id={`status-drawer-${open}`} className="animate-fade-in mt-3 border-t border-hairline px-1 pt-4">
          {open === "deadline" && (
            <BidDeadlineEditor
              deadline={deadline.deadline}
              ownSet={deadline.source === "pilot"}
              packClose={deadline.packClose}
              onSave={deadline.save}
              onClear={deadline.clear}
              onDone={() => setOpen(null)}
            />
          )}
          {open === "chances" && (
            <ForecastBanner
              bare
              forecast={f.forecast}
              response={f.response}
              loading={f.loading}
              failed={f.failed}
              seniorityNumber={profile.seniorityNumber}
              hasList={f.hasList}
              onAddSeniority={onEditPreferences}
              realisticCount={f.realisticCount}
              showingRealistic={f.showingRealistic}
              onToggleRealistic={f.onToggleRealistic}
              canShare={f.canShare}
              sharing={f.sharing}
              onSharingChange={f.onSharingChange}
            />
          )}
          {open === "profile" && (
            <div className="space-y-4">
              {(confidenceLevel === "thin" || confidenceLevel === "moderate") && (
                <p className="text-sm text-ink-muted">
                  These rankings are based on a{confidenceLevel === "thin" ? " shorter" : " moderate-length"} interview
                  {confidenceLevel === "thin" ? ", so treat them as a first cut" : ""}.
                </p>
              )}
              {inYourWords > 0 && (
                <div>
                  <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-faint">In your words</div>
                  <PilotProfileSummary profile={profile} bare />
                </div>
              )}
              <button
                type="button"
                onClick={onEditPreferences}
                className="text-sm font-medium text-accent underline decoration-dotted underline-offset-4 hover:text-ink"
              >
                Review or sharpen your preferences
              </button>
            </div>
          )}
          {open === "since" && <BidPeriodChangeBanner summary={bidPeriodChange} bare />}
        </div>
      )}
    </section>
  );
}
