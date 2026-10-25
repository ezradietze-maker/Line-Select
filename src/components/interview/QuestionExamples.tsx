"use client";

import { tripDuties, tripHeadline } from "@/lib/brain/line-text";
import type { QuestionExample } from "@/lib/brain/question-examples";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Trip } from "@/types/bidpack";

/** "Few departures: 2 departures" → the priority, and the figure that goes with it. */
function splitFact(fact: string): { what: string; figure: string } {
  const i = fact.indexOf(": ");
  return i < 0 ? { what: "", figure: fact } : { what: fact.slice(0, i), figure: fact.slice(i + 2) };
}

function TripLine({ bidPack, trip }: { bidPack: BidPack; trip: Trip }) {
  return (
    <details className="group border-l-2 border-border-strong pl-2.5">
      <summary className="cursor-pointer list-none font-mono text-xs leading-relaxed text-ink [overflow-wrap:anywhere] marker:hidden">
        <span className="text-accent group-open:hidden" aria-hidden>
          ▸{" "}
        </span>
        <span className="hidden text-accent group-open:inline" aria-hidden>
          ▾{" "}
        </span>
        {tripHeadline(bidPack, trip)}
      </summary>
      <ul className="mt-1.5 space-y-1 font-mono text-[11px] leading-relaxed text-ink-muted [overflow-wrap:anywhere]">
        {tripDuties(trip).map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </details>
  );
}

function ExampleCard({ example, bidPack }: { example: QuestionExample; bidPack: BidPack }) {
  const { what, figure } = splitFact(example.fact);
  const line = example.kind === "line" ? bidPack.lines.find((l) => l.lineNumber === example.ref) : undefined;
  const trip = example.kind === "trip" ? bidPack.lines.flatMap((l) => l.trips).find((t) => tripKey(t) === example.ref) : undefined;
  if (!line && !trip) return null;
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-3.5" aria-label={example.title}>
      {example.rank ? <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">#{example.rank} on your list</p> : null}
      <p className="font-display text-lg font-semibold text-ink">{example.title}</p>
      <p className="mt-0.5 text-sm leading-snug">
        {what ? <span className="text-ink-muted">{what}: </span> : null}
        <span className="font-semibold text-accent">{figure}</span>
      </p>
      {line ? (
        <>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {line.daysOff} days off · {line.totalCreditHours.toFixed(1)} credit · {line.trips.length} {line.trips.length === 1 ? "trip" : "trips"}
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {line.trips.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <TripLine bidPack={bidPack} trip={t} />
              </li>
            ))}
          </ul>
        </>
      ) : trip ? (
        <div className="mt-2">
          <TripLine bidPack={bidPack} trip={trip} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The real lines or trips a question is about, from the pilot's own pack — so they answer about lines they can see
 * rather than ones they have to imagine. Each shows the figure the question turns on; trips open to their duties.
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
