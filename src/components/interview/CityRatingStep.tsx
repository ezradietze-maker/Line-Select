"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { MicButton } from "@/components/ui/MicButton";
import { airportCityName } from "@/lib/airport-city-names";
import { CITY_RATING_STEPS, CITY_REASONS, effectiveCityScore, type CityFacts } from "@/lib/city-ratings";
import { useDictation } from "@/lib/use-speech-to-text";
import type { CityRating, CityRatingScore, CityReasonTag, CitySentiment } from "@/types/preferences";

/** Search box only appears once the list is long enough that scanning it by eye stops being practical. */
const SEARCH_THRESHOLD = 16;

interface CityRatingStepProps {
  /** Every layover city in the pack with what the pack holds there, most-flown first. */
  cities: CityFacts[];
  ratings: Record<string, CityRating>;
  /** Earlier favorite/avoid marks (from the story or last cycle) — shown as grades until the pilot gives one. */
  sentiments: Record<string, CitySentiment>;
  onRate: (code: string, score: CityRatingScore | 0) => void;
  onReasons: (code: string, reasons: CityReasonTag[]) => void;
  onNote: (code: string, note: string) => void;
  eyebrow?: string;
  /** Cities the bidding story itself named, already marked — said out loud so the marks aren't a mystery. */
  fromStory?: string[];
  /** The city a commuter commutes from, when it's a layover here — marked as loved, and said why. */
  homeCity?: string;
}

const PROMPT = "How do you feel about each layover city?";

/** Pill colors per grade — the same good/warn/danger language the rest of the app uses. */
const GRADE_STYLE: Record<number, string> = {
  [-2]: "border-danger bg-danger-soft text-danger",
  [-1]: "border-warn bg-warn-soft text-warn",
  0: "border-border-strong bg-surface-raised text-ink",
  1: "border-good/60 bg-good-soft text-good",
  2: "border-good bg-good text-on-brand",
};

const hrs = (h: number) => `${Math.round(h)}h`;

function CityNote({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const dictation = useDictation(value, onChange);
  return (
    <div>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Anything else? Favorite restaurant, the bed, friends there… (optional)"
          aria-label={label}
          rows={2}
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
    </div>
  );
}

function CityRow({
  facts,
  score,
  rating,
  onRate,
  onReasons,
  onNote,
}: {
  facts: CityFacts;
  score: CityRatingScore | 0;
  rating: CityRating | undefined;
  onRate: (s: CityRatingScore | 0) => void;
  onReasons: (r: CityReasonTag[]) => void;
  onNote: (n: string) => void;
}) {
  const name = airportCityName(facts.code);
  const reasons = rating?.reasons ?? [];
  const length = facts.minHours === facts.maxHours ? hrs(facts.medianHours) : `usually ${hrs(facts.medianHours)} (${hrs(facts.minHours)}–${hrs(facts.maxHours)})`;
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0">
          <span className="font-mono text-sm font-semibold text-ink">{facts.code}</span>
          {name && <span className="ml-2 text-sm text-ink">{name}</span>}
        </p>
        <p className="font-mono text-[11px] text-ink-faint">
          {facts.trips} {facts.trips === 1 ? "trip" : "trips"} · {length}
          {facts.standbyDays > 0 && ` · ${facts.standbyDays} standby ${facts.standbyDays === 1 ? "day" : "days"}`}
        </p>
      </div>
      {facts.hotel && <p className="mt-0.5 truncate text-xs text-ink-muted">{facts.hotel}</p>}

      <div className="mt-2 grid grid-cols-5 gap-1" role="group" aria-label={`Rate ${name ?? facts.code}`}>
        {CITY_RATING_STEPS.map((step) => {
          const on = step.score === score;
          return (
            <button
              key={step.score}
              type="button"
              aria-pressed={on}
              onClick={() => onRate(on ? 0 : step.score)}
              className={`rounded-md border px-1 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                on ? GRADE_STYLE[step.score] : "border-border text-ink-muted hover:border-border-strong hover:text-ink"
              }`}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      {score !== 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-muted">What makes it {score > 0 ? "good" : "bad"}?</p>
          <div className="flex flex-wrap gap-1.5">
            {CITY_REASONS.map((r) => {
              const on = reasons.includes(r.tag);
              return (
                <button
                  key={r.tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onReasons(on ? reasons.filter((t) => t !== r.tag) : [...reasons, r.tag])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <CityNote value={rating?.note ?? ""} onChange={onNote} label={`Note on ${name ?? facts.code}`} />
        </div>
      )}
    </li>
  );
}

/**
 * The interview's city step: every layover city in the pilot's own pack,
 * each with what the pack really holds there (how many trips, how long the
 * layovers run, which hotel), graded Avoid … Love, with the reasons behind
 * a grade. Location is half of what makes a layover good, and only the
 * pilot knows which cities have their food, their friends, and a bed that
 * doesn't hurt their back.
 */
export function CityRatingStep({ cities, ratings, sentiments, onRate, onReasons, onNote, eyebrow, fromStory = [], homeCity }: CityRatingStepProps) {
  const [query, setQuery] = useState("");
  const showSearch = cities.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const scoreOf = (code: string) => effectiveCityScore(code, ratings, sentiments);
  // A city that already has a grade always stays visible, even mid-search, so a pilot never loses sight of one they rated.
  const visible = q ? cities.filter((c) => c.code.toLowerCase().includes(q) || (airportCityName(c.code) ?? "").toLowerCase().includes(q) || scoreOf(c.code) !== 0) : cities;
  const rated = cities.filter((c) => scoreOf(c.code) !== 0).length;

  return (
    <div>
      <QuestionPrompt
        eyebrow={eyebrow}
        title={PROMPT}
        help={
          <>
            All {cities.length} layover cities in your bid pack, most-flown first, with the layovers you&rsquo;d actually get there. Rate
            the ones you have a feeling about &mdash; where you&rsquo;d love a long layover, and where you&rsquo;d rather spend as little
            time as possible. Skip the rest.
          </>
        }
      />

      <RevealControls title={PROMPT} className="mt-6">
        {homeCity && (
          <p className="mb-3 rounded-lg border border-good/30 bg-good-soft/50 px-3 py-2 text-xs text-ink-muted">
            <span className="font-medium text-good">{homeCity} is home:</span> marked Love &mdash; a layover there is a night at home. Change
            it if you like.
          </p>
        )}
        {fromStory.length > 0 && (
          <p className="mb-3 rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-2 text-xs text-ink-muted">
            <span className="font-medium text-accent">From your story:</span> {fromStory.join(", ")} already rated &mdash; adjust them if
            they&rsquo;re off.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {rated} of {cities.length} rated
          </p>
        </div>
        {showSearch && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Find a city (${cities.length} in this pack)`}
            aria-label="Find a layover city"
            className="mt-2 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        )}

        <ul className="mt-3 space-y-2">
          {visible.map((c) => (
            <CityRow
              key={c.code}
              facts={c}
              score={scoreOf(c.code)}
              rating={ratings[c.code]}
              onRate={(s) => onRate(c.code, s)}
              onReasons={(r) => onReasons(c.code, r)}
              onNote={(n) => onNote(c.code, n)}
            />
          ))}
        </ul>
      </RevealControls>

      {cities.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">
          No layover cities to show yet &mdash; this step will be more useful once your bid pack has verified trip-by-trip data.
        </p>
      )}
    </div>
  );
}
