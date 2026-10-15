"use client";

import { useState } from "react";
import { BedIcon, ChevronDownIcon, MoonIcon, SunriseIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import type { LayoverSleepPlan, SleepBlock } from "@/lib/sleep-plan";
import type { TimelineSegment } from "@/lib/trip-timeline";

/**
 * The suggested sleep on every layover (see `lib/sleep-plan.ts`): drawn over the hotel time on the trip chart, and laid
 * out layover by layover in a "Rest plan" — each stay as a ribbon from hotel to wake-up, shaded by how easily the
 * pilot's body can sleep at each hour, with the suggested sleeps on it and why each one is there.
 */

const MINUTES_PER_DAY = 24 * 60;
const isNap = (k: SleepBlock["kind"]) => k === "nap" || k === "preDuty";

/** How a block of each kind is drawn — solid night blue for real sleep, a lighter dashed bar for naps. */
function blockClass(kind: SleepBlock["kind"]): string {
  if (kind === "sleep") return "bg-sleep text-canvas shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]";
  if (kind === "recovery") return "bg-sleep/75 text-canvas";
  return "border border-dashed border-sleep bg-sleep-soft text-sleep";
}

const hoursOf = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};

/** The day's suggested sleep, over the hotel time in a trip-chart day column. */
export function SleepOverlay({ segments, hourHeightPx }: { segments: TimelineSegment[]; hourHeightPx: number }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.sleep) return null;
        const minutes = Math.max(0, seg.endMinuteOfDay - seg.startMinuteOfDay);
        const px = (minutes / 60) * hourHeightPx;
        const nap = isNap(seg.sleep.kind);
        const times = seg.startClock && seg.endClock ? `${seg.startClock}–${seg.endClock}` : "";
        return (
          <div
            key={i}
            title={`${seg.sleep.title}${times ? ` · ${times}` : ""}\n${seg.sleep.why}`}
            className={`absolute left-2 right-1.5 z-[1] flex flex-col items-center justify-center overflow-hidden px-0.5 text-center leading-tight ${blockClass(seg.sleep.kind)} ${seg.continuesFromPreviousDay ? "" : "rounded-t-md"} ${seg.continuesToNextDay ? "" : "rounded-b-md"}`}
            style={{ top: `${(seg.startMinuteOfDay / MINUTES_PER_DAY) * 100}%`, height: `${(minutes / MINUTES_PER_DAY) * 100}%` }}
          >
            {px >= 14 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wide">
                <MoonIcon className="h-2.5 w-2.5 shrink-0" />
                {px >= 22 && (nap ? "Nap" : seg.sleep.kind === "recovery" ? "Rest" : "Sleep")}
              </span>
            )}
            {px >= 36 && times && !seg.continuesFromPreviousDay && !seg.continuesToNextDay && <span className="font-mono text-[9px] opacity-85">{times}</span>}
          </div>
        );
      })}
    </>
  );
}

/** The local clock at a trip minute, given the plan's own arrival time and clock. */
function localMinute(plan: LayoverSleepPlan, at: number): number {
  const [h, m] = plan.inHotelLocal.split(":").map(Number);
  return (((h * 60 + m + (at - plan.inHotel)) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** One layover's stay, hotel to wake-up: shaded by how easily the body can sleep, the suggested sleeps on top. */
function Ribbon({ plan }: { plan: LayoverSleepPlan }) {
  const span = Math.max(1, plan.wakeBy - plan.inHotel);
  const pct = (m: number) => `${((m - plan.inHotel) / span) * 100}%`;
  // Darker where the body clock makes sleep easy, at most ~96 stops.
  const step = Math.max(1, Math.ceil(plan.ribbon.length / 96));
  const stops = plan.ribbon
    .filter((_, i) => i % step === 0 || i === plan.ribbon.length - 1)
    .map((r) => `color-mix(in srgb, var(--color-sleep) ${Math.round(8 + r.ease * 42)}%, transparent) ${(((r.at - plan.inHotel) / span) * 100).toFixed(1)}%`);
  // Local-clock ticks every six hours.
  const ticks: { at: number; label: string }[] = [];
  const firstLocal = localMinute(plan, plan.inHotel);
  for (let m = plan.inHotel + ((360 - (firstLocal % 360)) % 360); m < plan.wakeBy; m += 360) {
    const lm = localMinute(plan, m);
    ticks.push({ at: m, label: lm === 0 ? "00" : String(Math.round(lm / 60)).padStart(2, "0") });
  }
  return (
    <div className="relative mt-5">
      <div className="relative h-8 overflow-hidden rounded-md ring-1 ring-inset ring-hairline" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}>
        {ticks.map((t) => (
          <div key={t.at} className="absolute inset-y-0 w-px bg-ink/15" style={{ left: pct(t.at) }} aria-hidden />
        ))}
        {plan.blocks.map((b, i) => (
          <div
            key={i}
            title={`${b.title} · ${b.startLocal}–${b.endLocal}\n${b.why}`}
            className={`absolute flex items-center justify-center gap-1 overflow-hidden rounded ${isNap(b.kind) ? "inset-y-2" : "inset-y-1"} ${blockClass(b.kind)}`}
            style={{ left: pct(b.start), width: pct(plan.inHotel + (b.end - b.start)) }}
          >
            <MoonIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-mono text-[10px] font-semibold">{hoursOf(b.end - b.start)}</span>
          </div>
        ))}
      </div>
      {ticks.map((t) => (
        <span key={t.at} className="absolute -top-4 -translate-x-1/2 font-mono text-[9px] text-ink-faint" style={{ left: pct(t.at) }} aria-hidden>
          {t.label}
        </span>
      ))}
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <BedIcon className="h-3 w-3" /> In the hotel {plan.inHotelLocal}
        </span>
        <span className="inline-flex items-center gap-1">
          Up by {plan.wakeByLocal} <SunriseIcon className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

const QUALITY: Record<LayoverSleepPlan["quality"], { label: string; tone: string }> = {
  good: { label: "Good rest", tone: "bg-good-soft text-good" },
  short: { label: "Short rest", tone: "bg-warn-soft text-warn" },
  poor: { label: "Poor rest", tone: "bg-danger-soft text-danger" },
};

function LayoverPlan({ plan }: { plan: LayoverSleepPlan }) {
  const q = QUALITY[plan.quality];
  return (
    <li className="rounded-lg border border-hairline bg-canvas/50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-ink">{plan.city}</span>
          <span className="font-mono text-[11px] text-ink-muted">{hoursOf(plan.wakeBy - plan.inHotel)} in the hotel</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${q.tone}`}>
          {q.label} · {plan.totalSleepHours.toFixed(1)}h
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">{plan.bodyClockNote}</p>
      {plan.blocks.length > 0 ? <Ribbon plan={plan} /> : <p className="mt-2 text-xs text-warn">Too short to plan any real sleep here — rest with your eyes closed if you can.</p>}
      <ul className="mt-2.5 space-y-1.5">
        {plan.blocks.map((b, i) => (
          <li key={i} className="text-xs leading-relaxed">
            <span className="font-mono font-semibold text-sleep">
              {b.startLocal}–{b.endLocal}
            </span>{" "}
            <span className="font-medium text-ink">{b.title}</span> <span className="text-ink-muted">— {b.why}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The science the plan rests on, with its sources — so a pilot can check it rather than take it on faith. */
export function SleepScienceInfo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink">
        <MoonIcon className="h-2.5 w-2.5" />
        How is sleep planned?
      </button>
      {open && (
        <Modal title="How your rest plan is worked out" onClose={() => setOpen(false)}>
          <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
            <p>
              Each layover&rsquo;s plan comes from the trip&rsquo;s real printed times and your body clock — the same science airline fatigue programs teach crews. It&rsquo;s guidance for planning your rest, not
              medical advice.
            </p>
            <ul className="space-y-2">
              <li>
                <span className="font-medium text-ink">Two things decide when you can sleep:</span> how long you&rsquo;ve been awake, and your body clock. Sleep comes easiest in your body&rsquo;s night, and
                hardest in the few hours before your usual bedtime — even when you&rsquo;re tired. <span className="text-ink-faint">(Borbély&rsquo;s two-process model of sleep.)</span>
              </li>
              <li>
                <span className="font-medium text-ink">Your body clock runs on home time.</span> It shifts toward local time only about an hour a day flying east, an hour and a half flying west — so on a
                short layover across the world your body is still at home, and the plan follows your body, not the hotel clock.{" "}
                <span className="text-ink-faint">(Waterhouse et al., The Lancet, 2007.)</span>
              </li>
              <li>
                <span className="font-medium text-ink">02:00–06:00 body time is the window of circadian low</span> — when sleep drive peaks and alertness bottoms out. A duty that flies through it gets a nap
                planned before it. <span className="text-ink-faint">(FAA and ICAO fatigue guidance.)</span>
              </li>
              <li>
                <span className="font-medium text-ink">Sleep in whole cycles.</span> Adults need 7–9 hours; ending a sleep after full ~90-minute cycles, or keeping a nap to 20–30 minutes, avoids waking
                groggy. <span className="text-ink-faint">(American Academy of Sleep Medicine.)</span>
              </li>
              <li>
                <span className="font-medium text-ink">Planned naps work.</span> NASA&rsquo;s study of long-haul crews found a short planned nap markedly improved performance and alertness; napping
                before a night duty cuts its fatigue. <span className="text-ink-faint">(Rosekind et al., NASA, 1994.)</span>
              </li>
              <li>
                <span className="font-medium text-ink">After an all-nighter, sleep twice.</span> A recovery sleep on arrival plus a main sleep in your body&rsquo;s night beats one long daytime sleep, which
                your body clock cuts short — so daytime main sleeps are planned as four cycles with a nap before you go.{" "}
                <span className="text-ink-faint">(Minors &amp; Waterhouse&rsquo;s anchor sleep; Åkerstedt&rsquo;s shift-work studies.)</span>
              </li>
            </ul>
            <div className="rounded-lg border border-border bg-canvas p-3 text-xs">
              <div className="font-medium text-ink">What it assumes</div>
              <p className="mt-1">
                At home you keep a normal day (asleep about 23:00–07:00 base time). You&rsquo;re in the hotel 45 minutes after block-in, asleep 20 minutes later, and up 90 minutes before report — or 45
                before a printed hotel pickup. If your home routine is different (a night-sort regular, say), shift the plan to match.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The trip's rest plan, layover by layover — open by default on a short trip, a summary line on a long one. */
export function RestPlan({ plans }: { plans: LayoverSleepPlan[] }) {
  const [open, setOpen] = useState(plans.length <= 3);
  if (!plans.length) return null;
  const total = plans.reduce((a, p) => a + p.totalSleepHours, 0);
  const short = plans.filter((p) => p.quality !== "good").length;
  return (
    <div className="mt-3 rounded-lg border border-sleep/25 bg-sleep-soft/40">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sleep text-canvas">
          <MoonIcon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-sleep">Rest plan</span>
          <span className="block text-xs text-ink-muted">
            {total.toFixed(0)}h of sleep planned across {plans.length} {plans.length === 1 ? "layover" : "layovers"}
            {short ? ` · ${short} short ${short === 1 ? "rest" : "rests"}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 gap-1" aria-hidden>
          {plans.map((p, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${p.quality === "good" ? "bg-good" : p.quality === "short" ? "bg-warn" : "bg-danger"}`} />
          ))}
        </span>
        <ChevronDownIcon className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-sleep/20 px-3 pb-3 pt-2">
          <ul className="space-y-2">
            {plans.map((p) => (
              <LayoverPlan key={p.dutyIndex} plan={p} />
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-6 rounded-sm" style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--color-sleep) 8%, transparent), color-mix(in srgb, var(--color-sleep) 50%, transparent))" }} />
                Darker = easier for your body to sleep
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-3 rounded-sm bg-sleep" /> Sleep
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-3 rounded-sm border border-dashed border-sleep bg-sleep-soft" /> Nap
              </span>
            </div>
            <SleepScienceInfo />
          </div>
        </div>
      )}
    </div>
  );
}
