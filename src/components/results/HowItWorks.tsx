import type { ReactNode } from "react";
import { Heading } from "@/components/ui/Heading";

interface Point {
  icon: ReactNode;
  title: string;
  body: ReactNode;
}

const POINTS: Point[] = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
    title: "How your score is built",
    body: (
      <>
        Line Select reads your own uploaded bid pack PDF and compares each
        line&rsquo;s real attributes &mdash; days off, trip length,
        duty periods, international mix, layover cities, report-time lean,
        credit hours, deadhead legs, and layover hotel quality &mdash;
        against the targets implied by your answers, then blends them into a
        single 0-100 score weighted by how strongly you felt about each one.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-3.5-3.5M12 15l3.5-3.5" />
        <path strokeLinecap="round" d="M5 19h14" />
      </svg>
    ),
    title: "Exact targets override sliders",
    body: (
      <>
        Several questions let you pin an exact number instead of just leaning
        a slider &mdash; days off, duty periods, and (in the deeper round)
        credit hours &mdash; and that exact target is used directly instead
        of the rough midpoint a slider alone implies.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v4m0 3.5h.01" />
      </svg>
    ),
    title: "What this isn't",
    body: (
      <>
        <strong className="text-ink">
          The match score predicts your satisfaction, not what you&rsquo;ll be awarded.
        </strong>{" "}
        It only tells you which lines, on paper, look closest to what you said
        you want. If you give your seniority number, a separate estimate shows
        your chance at each line from where you sit in bid order &mdash; a
        statistical guess that gets sharper as more pilots use the app, never
        a promise of what you&rsquo;ll actually hold.
      </>
    ),
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
        <rect x="5" y="11" width="14" height="9" rx="1.5" />
        <path strokeLinecap="round" d="M8 11V7a4 4 0 018 0v4" />
      </svg>
    ),
    title: "What happens to your bid pack",
    body: (
      <>
        Your bid pack PDF is uploaded to this app&rsquo;s own server to be
        parsed &mdash; never to FedEx or any third party &mdash; and the PDF
        itself isn&rsquo;t stored once parsing finishes. The extracted line
        data and your preferences are then stored on this device, and on the
        server too if you create an account. Beyond the upload itself, the
        server sees: your interview answers (sent to an AI provider to write
        the next question), hotel names (looked up on Google), your
        seniority number and line ranking if you ask for a bid forecast
        (numbers only, never the pack), a numeric summary of your finished
        interview (never your words) that helps it ask future pilots better
        questions, and anything you post to the Trade Board or send as
        feedback. The Privacy Policy has the full list.
      </>
    ),
  },
];

/** The four things worth knowing, as waypoints down one route line. Also shown in the sidebar's "How this works" dialog. */
export function HowItWorksContent() {
  return (
    <ul className="relative space-y-6">
      <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-px bg-gradient-to-b from-accent/60 via-hairline to-transparent" />
      {POINTS.map((point) => (
        <li key={point.title} className="relative flex gap-4">
          <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-panel text-accent shadow-[0_0_14px_-4px_var(--color-accent)]">
            {point.icon}
          </div>
          <div className="min-w-0 pt-1.5">
            <Heading as="h3" className="text-base text-ink">
              {point.title}
            </Heading>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{point.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
