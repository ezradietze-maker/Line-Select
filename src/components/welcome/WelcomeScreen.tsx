"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/Button";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { NightGlobe } from "@/components/welcome/NightGlobe";
import { CalendarVisual, InterviewVisual, ParseVisual, RankVisual } from "@/components/welcome/StoryVisuals";
import { EASE } from "@/lib/motion-tokens";

const STEPS: { eyebrow: string; title: string; body: string; Visual: ComponentType<{ active: boolean }> }[] = [
  {
    eyebrow: "01 · Load",
    title: "It reads the whole pack, not a summary of it.",
    body: "Every pairing, every line, every layover, read straight from your bid pack PDF — the real schedule behind each line, down to the hotel and the report time.",
    Visual: ParseVisual,
  },
  {
    eyebrow: "02 · Brief",
    title: "Then it asks what matters, the way a pilot would.",
    body: "No quiz. A short conversation that goes deeper where your answers get interesting, skips what you've already said, and picks up how you talk.",
    Visual: InterviewVisual,
  },
  {
    eyebrow: "03 · Rank",
    title: "Every line scored against you — with the reason.",
    body: "A 0–100 score for each line, weighted by how much each thing matters to you, and a plain-English reason for every one. Dealbreakers are treated as dealbreakers.",
    Visual: RankVisual,
  },
  {
    eyebrow: "04 · Check",
    title: "Then see the month before you bid it.",
    body: "Each line laid out on the real calendar — trips, layovers, days off in a row — and checked against the dates you need home.",
    Visual: CalendarVisual,
  },
];

const TRUST = [
  {
    title: "Scored, not guessed",
    body: "Every line gets a 0–100 score against what you said matters, weighted by how much it matters.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Shows its work",
    body: "A plain-English reason for every score, and every month on a readable calendar instead of raw pairing text.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <path d="M7 3h8l4 4v14H7z" />
        <path strokeLinecap="round" d="M10 12h6M10 16h6M10 8h2" />
      </svg>
    ),
  },
  {
    title: "Yours alone",
    body: "Your PDF is parsed on our server and never stored there. The line data and your preferences stay on this device, unless you make an account to carry them with you.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path strokeLinecap="round" d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
  },
];

/**
 * Which story step is on screen: the last one whose top has passed the
 * middle of the viewport. Worked out from scroll position on every scroll
 * (one read per frame) rather than from intersection events, so a fast jump
 * — the "How it flies" link, a scrollbar drag — lands on the right step
 * instead of whichever one happened to cross the middle last.
 */
function useActiveStep(count: number) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const mid = window.innerHeight * 0.5;
      let next = 0;
      refs.current.slice(0, count).forEach((el, i) => {
        if (el && el.getBoundingClientRect().top < mid) next = i;
      });
      setActive(next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [count]);
  return { active, setRef: (i: number) => (el: HTMLElement | null) => void (refs.current[i] = el) };
}

function Story() {
  const { active, setRef } = useActiveStep(STEPS.length);
  return (
    <section aria-labelledby="story-heading" className="mx-auto max-w-6xl px-4 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">How it flies</div>
        <h2 id="story-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          From a 260-page PDF to the line that fits you.
        </h2>
      </div>

      <div className="mt-10 lg:mt-4 lg:grid lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <ol>
          {STEPS.map((s, i) => (
            <li
              key={s.eyebrow}
              ref={setRef(i)}
              data-step={i}
              className="flex flex-col justify-center py-10 lg:min-h-[78vh] lg:py-0"
            >
              <div className={`transition-opacity duration-500 ${active === i ? "lg:opacity-100" : "lg:opacity-35"}`}>
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">{s.eyebrow}</div>
                <h3 className="mt-3 font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">{s.title}</h3>
                <p className="mt-3 max-w-md text-base leading-relaxed text-ink-muted">{s.body}</p>
              </div>
              {/* On phones each step carries its own visual; on desktop they share the sticky panel. */}
              <div className="mt-6 lg:hidden">
                <s.Visual active={active >= i} />
              </div>
            </li>
          ))}
        </ol>
        <div className="hidden lg:block">
          <div className="sticky top-[14vh] flex h-[72vh] items-center">
            <div className="relative w-full">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.eyebrow}
                  aria-hidden={active !== i}
                  className={i === 0 ? "relative" : "absolute inset-x-0 top-0"}
                  initial={false}
                  animate={{ opacity: active === i ? 1 : 0, y: active === i ? 0 : active > i ? -16 : 16 }}
                  transition={{ duration: 0.5, ease: EASE.emphasized }}
                  style={{ pointerEvents: active === i ? "auto" : "none" }}
                >
                  <s.Visual active={active === i} />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The public front door — a full-bleed hero with a live 3D globe of real
 * routes, then a scroll story of what the app actually does, each step shown
 * with real data from a real bid pack. Every honesty note the old landing
 * carried is still here: not affiliated, what happens to the PDF, which
 * numbers are illustrative.
 */
export function WelcomeScreen({ onStart, onTrySample }: { onStart: () => void; onTrySample: () => void }) {
  const reduce = useReducedMotion();
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.09, delayChildren: reduce ? 0 : 0.1 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : 18 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.7, ease: EASE.emphasized } },
  };

  return (
    <div className="relative overflow-x-clip">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-9 w-9" />
          <Wordmark className="text-lg" />
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/how-it-works" className="rounded-md px-3 py-2 text-ink-muted transition-colors hover:text-ink">
            How it works
          </Link>
          <Link href="/auth" className="rounded-md border border-hairline px-3 py-2 text-ink transition-colors hover:border-border-strong">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="relative mx-auto grid max-w-7xl items-center gap-6 px-4 pb-16 pt-2 sm:px-8 lg:min-h-[calc(100svh-5rem)] lg:grid-cols-[1fr_1.1fr] lg:gap-4 lg:pb-8">
        {/* Instrument light pooling behind the globe. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-10%] top-[5%] -z-10 h-[70%] w-[70%] rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--glow-soft), transparent 65%)" }}
        />
        <motion.div variants={container} initial="hidden" animate="show" className="order-2 text-center lg:order-1 lg:text-left">
          <motion.span
            variants={item}
            className="inline-block max-w-full text-balance rounded-2xl border border-hairline bg-surface/70 px-3 py-1 font-mono text-[11px] uppercase leading-relaxed tracking-[0.14em] text-ink-faint backdrop-blur-sm sm:rounded-full"
          >
            Independent prototype &middot; not affiliated with FedEx
          </motion.span>
          <motion.h1
            variants={item}
            className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight text-ink sm:text-6xl xl:text-7xl"
          >
            Find the line that actually fits{" "}
            <span className="text-glow text-accent">how you want to fly.</span>
          </motion.h1>
          <motion.p variants={item} className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-muted lg:mx-0">
            Upload your bid pack, tell it what matters, and every line gets scored against you &mdash; with a plain-English
            reason for each score, so you can trust the answer instead of re-checking it by hand.
          </motion.p>
          <motion.div variants={item} className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Button onClick={onStart} className="glow-soft w-full px-7 py-3.5 text-base sm:w-auto">
              Upload your bid pack
            </Button>
            <button
              type="button"
              onClick={onTrySample}
              className="w-full rounded-lg border border-hairline px-6 py-3.5 text-base font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface/60 sm:w-auto"
            >
              Try it with sample data
            </button>
          </motion.div>
          <motion.p variants={item} className="mt-4 text-xs text-ink-faint">
            Parsed on our server, never stored there &mdash; only the extracted line data comes back to this device.
          </motion.p>
        </motion.div>

        <div className="order-1 mx-auto w-full max-w-[min(92vw,640px)] lg:order-2">
          <NightGlobe />
        </div>

        <a
          href="#story-heading"
          className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint transition-colors hover:text-ink-muted lg:flex"
        >
          How it flies
          <motion.svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
            animate={reduce ? undefined : { y: [0, 4, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </motion.svg>
        </a>
      </section>

      <div className="py-12 lg:py-20">
        <Story />
      </div>

      <section className="mx-auto max-w-6xl px-4 sm:px-8">
        <ul className="grid gap-4 border-y border-hairline py-10 sm:grid-cols-3">
          {TRUST.map((t) => (
            <li key={t.title} className="flex gap-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{t.icon}</div>
              <div>
                <h3 className="font-display text-base font-semibold text-ink">{t.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{t.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-8">
        <div className="panel-glass glow-soft relative overflow-hidden px-6 py-12 text-center sm:px-12">
          <LogoMark className="mx-auto h-12 w-12" detailed />
          <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Your next bid starts with your pack.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-ink-muted">About a minute to upload and read. A few more if you want the interview to go deep.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={onStart} className="w-full px-7 py-3.5 text-base sm:w-auto">
              Upload your bid pack
            </Button>
            <button
              type="button"
              onClick={onTrySample}
              className="w-full rounded-lg px-6 py-3.5 text-base font-medium text-ink-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-ink sm:w-auto"
            >
              Or try it with sample data
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
