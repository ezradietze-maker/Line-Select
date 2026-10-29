"use client";

import { useState } from "react";
import { TripGlance } from "@/components/interview/TripGlance";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { TRIP_GRADES, type TripGrade, type TripGradeScreen } from "@/lib/brain/trip-sort";
import { tripKey } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Trip } from "@/types/bidpack";

interface TripSortStepProps {
  eyebrow?: string;
  screen: TripGradeScreen;
  bidPack: BidPack;
  /** Which screen this is, for the heading ("1 of 2"). */
  index: number;
  /** Their grade for each trip they graded, and what they said about it. */
  onAnswer: (grades: Record<string, TripGrade>, why: string) => Promise<void>;
  onSkip: () => void;
}

const GRADE_LABEL: Record<TripGrade, string> = { love: "Love it", good: "Good", fine: "Fine", poor: "Poor", "trade away": "Trade it away" };
/** Trips they have to grade before they can go on — a trip they can't judge can be left blank. */
const MIN_GRADED = 4;

function TripCard({ bidPack, trip, label, grade, onGrade }: { bidPack: BidPack; trip: Trip; label: string; grade: TripGrade | undefined; onGrade: (g: TripGrade) => void }) {
  const id = `trip-${tripKey(trip).replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <li className={`rounded-xl border p-3.5 transition-colors ${grade ? "border-brand/50 bg-brand-soft/30" : "border-border bg-surface"}`}>
      <p id={`${id}-label`} className="font-display text-lg font-semibold text-ink">
        {label}
      </p>
      <div className="mt-1">
        <TripGlance bidPack={bidPack} trip={trip} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={`${id}-label`}>
        {TRIP_GRADES.map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={grade === g}
            onClick={() => onGrade(g)}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              grade === g ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong hover:text-ink"
            }`}
          >
            {GRADE_LABEL[g]}
          </button>
        ))}
      </div>
    </li>
  );
}

/**
 * A screen of real trips from the pilot's best lines, each graded the way they'd size it up on a trade board. Lines are
 * built from trips, but what decides a month of lines isn't always what decides a single trip — these grades tune how
 * each priority counts on a trip, so the trip scores on their results are theirs, and their lines lean on them.
 */
export function TripSortStep({ eyebrow, screen, bidPack, index, onAnswer, onSkip }: TripSortStepProps) {
  const [grades, setGrades] = useState<Record<string, TripGrade>>({});
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trips = new Map(bidPack.lines.flatMap((l) => l.trips).map((t) => [tripKey(t), t]));
  const graded = Object.keys(grades).length;
  const title = "How would you feel about flying each of these trips?";

  async function submit() {
    if (graded < MIN_GRADED || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAnswer(grades, why);
    } catch {
      setError("Couldn't send that — check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={title}
        help={`Real trips from your best lines${index > 0 ? ` (set ${index + 1})` : ""}. Grade each one the way you'd size it up on a trade board — just the trip, not the line it's on. Your grades shape how every trip on your results is scored, and how your lines are ranked.`}
      />
      <RevealControls title={title} className="mt-6">
        <ul className="space-y-2.5">
          {screen.keys.map((k) => {
            const t = trips.get(k);
            return t ? <TripCard key={k} bidPack={bidPack} trip={t} label={screen.labels[k]} grade={grades[k]} onGrade={(g) => setGrades((prev) => ({ ...prev, [k]: g }))} /> : null;
          })}
        </ul>

        <NoteBox value={why} onChange={setWhy} placeholder="What decided your grades? (optional)" ariaLabel="What decided your grades" className="mt-4" />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onSkip} disabled={busy} className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
            Skip these
          </button>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-faint" aria-live="polite">
              {graded} of {screen.keys.length} graded
            </span>
            <Button type="button" onClick={submit} disabled={graded < MIN_GRADED || busy} className="sm:px-6">
              {busy ? "Sending…" : "Continue"}
            </Button>
          </div>
        </div>
      </RevealControls>
    </div>
  );
}
