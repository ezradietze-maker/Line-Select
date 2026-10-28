"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import type { PilotModel } from "@/types/pilot-model";

/**
 * The one place the interview names topics the pilot never raised: a single
 * screen near the end, "do any of these matter?" — so nothing important is
 * missed, without a checklist of questions about things they don't care
 * about. Topics their own answers already covered aren't shown.
 */

export const SWEEP_TOPICS: { id: string; label: string; metrics: string[] }[] = [
  { id: "days-off", label: "Days off & weekends", metrics: ["daysOff", "weekendDaysOff", "longestDaysOffBlock", "weekdaysOff"] },
  { id: "dates", label: "Specific dates off this month", metrics: ["requestedDatesWorked"] },
  { id: "trip-length", label: "Trip length & how often you leave home", metrics: ["avgTripDays", "longestTripDays", "tripCount", "homeDepartures"] },
  { id: "report-times", label: "Report & release times", metrics: ["earliestBaseReport", "latestBaseRelease", "earlyReports"] },
  { id: "nights", label: "Night flying & red-eyes", metrics: ["redEyeLegs", "nightsWorked", "longestNightStreak", "deepNightHours", "backToBackRedEyes", "avgCircadianStars", "worstCircadianStars"] },
  { id: "pay", label: "Pay & credit", metrics: ["creditHours", "creditPerDayAway", "effectiveCreditPerDayAway", "creditPerDayAwayFromHome"] },
  { id: "layover-length", label: "Layover length", metrics: ["avgLayoverHours", "layoversInRange", "shortLayovers", "longLayoverHours", "sleepableLayovers", "avgLayoverNightHours"] },
  { id: "long-duties", label: "Long duty days", metrics: ["longDuties", "maxDutyHours"] },
  { id: "legs", label: "Legs per duty & landings", metrics: ["extraLegs", "dutiesWithManyLegs", "singleLegDutyShare", "avgLegsPerDuty", "maxLegsInADuty", "landings"] },
  { id: "deadheads", label: "Deadheads & commuting", metrics: ["frontDeadheadTrips", "backDeadheadTrips", "doubleDeadheadTrips", "baseCommutesNeeded", "departureCommutes", "baseHotelNights", "homeAwayHours", "tripsJoinedFromHome", "tripsEndingStraightHome", "shortenableHours", "tripsShortenableByADay"] },
  { id: "standby", label: "Hotel standby", metrics: ["hotelStandbyDays", "tripStandbyDays", "baseStandbyDays", "standbyDaysByCity"] },
  { id: "international", label: "International vs domestic", metrics: ["internationalLayoverShare", "layoverShareInRegions"] },
];

/** The topics the pilot's model doesn't touch yet. */
export function uncoveredTopics(model: PilotModel | null) {
  const used = new Set(model?.criteria.map((c) => c.metric) ?? []);
  return SWEEP_TOPICS.filter((t) => !t.metrics.some((m) => used.has(m)));
}

interface TopicSweepStepProps {
  topics: { id: string; label: string }[];
  eyebrow?: string;
  onContinue: (picked: string[], note: string) => void;
}

export function TopicSweepStep({ topics, eyebrow, onContinue }: TopicSweepStepProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const title = "Anything else that matters when you bid?";
  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={title}
        help="You haven’t brought these up. Tap any that matter to you — skip the ones that don’t."
      />
      <RevealControls title={title} className="mt-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Topics that matter">
          {topics.map((t) => {
            const on = picked.includes(t.label);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.label) : [...p, t.label]))}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <NoteBox value={note} onChange={setNote} placeholder="Anything else — in your own words (optional)" ariaLabel="Anything else" className="mt-4" />
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => onContinue(picked, note.trim())} className="sm:px-6">
            {picked.length || note.trim() ? "Continue" : "Nothing else — build my priorities"}
          </Button>
        </div>
      </RevealControls>
    </div>
  );
}
