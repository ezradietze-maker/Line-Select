"use client";

import { TripFold, TripGlance } from "@/components/interview/TripGlance";
import { MiniLinePreview } from "@/components/results/MiniLinePreview";
import type { QuestionExample } from "@/lib/brain/question-examples";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";

/** The priority and the figure that goes with it ("Few departures", "2 departures"); an older example has both in its fact. */
function splitFact(example: QuestionExample): { what: string; figure: string } {
  if (example.priority !== undefined) return { what: example.priority, figure: example.fact };
  const i = example.fact.indexOf(": ");
  return i < 0 ? { what: "", figure: example.fact } : { what: example.fact.slice(0, i), figure: example.fact.slice(i + 2) };
}

function ExampleCard({ example, bidPack }: { example: QuestionExample; bidPack: BidPack }) {
  const { what, figure } = splitFact(example);
  const line = example.kind === "line" ? bidPack.lines.find((l) => l.lineNumber === example.ref) : undefined;
  const trip = example.kind === "trip" ? bidPack.lines.flatMap((l) => l.trips).find((t) => tripKey(t) === example.ref) : undefined;
  if (!line && !trip) return null;
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-3.5" aria-label={example.title}>
      {example.rank ? <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">#{example.rank} on your list</p> : null}
      <p className="font-display text-lg font-semibold text-ink">{example.title}</p>
      {/* The figure says what it counts ("4 long duty days"); the priority it's shown for sits above it. */}
      {what ? <p className="mt-0.5 text-xs leading-snug text-ink-muted">{what}</p> : null}
      <p className="text-sm font-semibold leading-snug text-accent">{figure}</p>
      {line ? (
        <>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {line.daysOff} days off · {line.totalCreditHours.toFixed(1)} credit · {line.trips.length} {line.trips.length === 1 ? "trip" : "trips"}
          </p>
          <div className="mt-2.5">
            <MiniLinePreview line={line} bidPeriodStart={bidPack.bidPeriodStart} bidPeriodDays={bidPack.bidPeriodDays} compact />
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {line.trips.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <TripFold bidPack={bidPack} trip={t} />
              </li>
            ))}
          </ul>
        </>
      ) : trip ? (
        <div className="mt-2">
          <TripGlance bidPack={bidPack} trip={trip} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The real lines or trips a question is about, from the pilot's own pack — so they answer about lines they can see
 * rather than ones they have to imagine. Each shows the figure the question turns on, and is drawn the way the results
 * draw it: a line as its month, a trip day by day.
 */
export function QuestionExamples({ examples, bidPack, className = "" }: { examples: QuestionExample[]; bidPack: BidPack; className?: string }) {
  if (!examples.length) return null;
  return (
    <div className={`grid gap-3 ${examples.length > 1 ? "sm:grid-cols-2" : ""} ${className}`}>
      {examples.map((e) => (
        <ExampleCard key={e.id} example={e} bidPack={bidPack} />
      ))}
    </div>
  );
}
