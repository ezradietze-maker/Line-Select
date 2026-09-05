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
        departures, international mix, layover cities, report-time lean,
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
        a slider &mdash; nights home, departures, and (in the deeper round)
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
          This is a preference-matching tool, not an awards predictor.
        </strong>{" "}
        It has no idea what your seniority is, what other pilots are
        bidding, or what you&rsquo;ll actually be awarded. It only tells you
        which lines, on paper, look closest to what you said you want.
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
        data and your preferences are then stored only on this device unless
        you create an account to save them. Account sign-in, Trade Board
        posts, and that one-time upload are the only things sent to a
        server.
      </>
    ),
  },
];

export function HowItWorksContent() {
  return (
    <div className="space-y-5">
      {POINTS.map((point) => (
        <div key={point.title} className="flex gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            {point.icon}
          </div>
          <div>
            <Heading as="h3" className="text-sm text-ink">
              {point.title}
            </Heading>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{point.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
