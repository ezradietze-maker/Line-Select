"use client";

import { useMemo, useState } from "react";
import { PackLineFold } from "@/components/interview/PackLineFold";
import { TripGlance } from "@/components/interview/TripGlance";
import { BidPackHeader, StripKey, stripLayout } from "@/components/results/BidPackStrip";
import { useMeasuredWidth } from "@/components/results/LegBars";
import { packColumnCount, packColumns } from "@/lib/bidpack-row";
import type { QuestionExample } from "@/lib/brain/question-examples";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";

/** The priority and the figure that goes with it ("Few departures", "2 departures"); an older example has both in its fact. */
function splitFact(example: QuestionExample): { what: string; figure: string } {
  if (example.priority !== undefined) return { what: example.priority, figure: example.fact };
  const i = example.fact.indexOf(": ");
  return i < 0 ? { what: "", figure: example.fact } : { what: example.fact.slice(0, i), figure: example.fact.slice(i + 2) };
}

/** What the question shows a line or trip for, and its figure: "Few departures · 2 departures". */
function Figure({ example }: { example: QuestionExample }) {
  const { what, figure } = splitFact(example);
  // A line shown only because the question names it has no figure; the strip says the rest.
  if (!figure) return example.rank ? <p className="text-2xs text-ink-faint font-medium">#{example.rank} on your list</p> : <p className="text-ink-muted">Named in the question</p>;
  return (
    <p className="leading-snug">
      {what ? <span className="text-ink-muted">{what} &middot; </span> : null}
      <span className="font-semibold text-accent">{figure}</span>
      {example.rank ? <span className="ml-2 text-2xs text-ink-faint font-medium">#{example.rank} on your list</span> : null}
    </p>
  );
}

/** Example lines, drawn the way the interview draws every line: the pack's own strips, on shared day columns, each opening to its month. */
function ExampleLines({ examples, bidPack }: { examples: QuestionExample[]; bidPack: BidPack }) {
  const columns = useMemo(() => packColumns(bidPack.bidPeriodStart, bidPack.bidPeriodDays, packColumnCount(bidPack)), [bidPack]);
  const [listRef, listWidth] = useMeasuredWidth<HTMLDivElement>(768);
  const layout = useMemo(() => stripLayout(listWidth, columns.length), [listWidth, columns.length]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const toggle = (ref: string) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (!next.delete(ref)) next.add(ref);
      return next;
    });
  return (
    <div>
      <StripKey view="pack" hint="Tap a line to open its calendar." className="mb-2" />
      <div ref={listRef} className="space-y-2">
        <BidPackHeader columns={columns} layout={layout} label="Line" sticky={false} />
        {examples.map((e) => (
          <PackLineFold
            key={e.id}
            bidPack={bidPack}
            lineNumber={e.ref}
            heading={e.rank ? `#${e.rank} on your list` : undefined}
            note={<Figure example={e} />}
            columns={columns}
            layout={layout}
            open={opened.has(e.ref)}
            onToggle={() => toggle(e.ref)}
          />
        ))}
      </div>
    </div>
  );
}

/** An example trip, day by day, under what it's shown for. */
function ExampleTrip({ example, bidPack }: { example: QuestionExample; bidPack: BidPack }) {
  const trip = bidPack.lines.flatMap((l) => l.trips).find((t) => tripKey(t) === example.ref);
  if (!trip) return null;
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-3.5" aria-label={example.title}>
      <p className="font-display text-lg font-semibold text-ink">{example.title}</p>
      <div className="text-sm">
        <Figure example={example} />
      </div>
      <div className="mt-2">
        <TripGlance bidPack={bidPack} trip={trip} />
      </div>
    </section>
  );
}

/**
 * The real lines or trips a question is about, from the pilot's own pack — so they answer about lines they can see
 * rather than ones they have to imagine. Each shows the figure the question turns on. Lines are drawn as the pack's own
 * strips, each opening to its full month and trips, the same as two lines to choose between; trips day by day.
 */
export function QuestionExamples({ examples, bidPack, className = "" }: { examples: QuestionExample[]; bidPack: BidPack; className?: string }) {
  if (!examples.length) return null;
  const lines = examples.filter((e) => e.kind === "line" && bidPack.lines.some((l) => l.lineNumber === e.ref));
  const trips = examples.filter((e) => e.kind === "trip");
  return (
    <div className={`space-y-3 ${className}`}>
      {lines.length ? <ExampleLines examples={lines} bidPack={bidPack} /> : null}
      {trips.length ? (
        <div className={`grid gap-3 ${trips.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {trips.map((e) => (
            <ExampleTrip key={e.id} example={e} bidPack={bidPack} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
