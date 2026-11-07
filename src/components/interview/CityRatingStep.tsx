"use client";

import { useState } from "react";
import { QuestionPrompt, RevealControls } from "@/components/interview/QuestionPrompt";
import { NoteBox } from "@/components/ui/NoteBox";
import { airportCityName } from "@/lib/airport-city-names";
import { CITY_RATING_STEPS, CITY_REASONS, effectiveCityScore, hasSeasons, saysMore, type CityFacts } from "@/lib/city-ratings";
import { monthName, monthsWords, seasonMonths } from "@/lib/seasons";
import type { CityRating, CityRatingScore, CityReasonTag, CitySentiment } from "@/types/preferences";

export type CitySeasonChange = (code: string, season: "winter" | "summer" | "months", value: { score: CityRatingScore | 0; months?: number[] } | undefined) => void;

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
  /** A grade for one season (`CitySeasonGrades`); without it, the step has no seasons. */
  onSeason?: CitySeasonChange;
  /** A grade for one of a city's hotels (undefined: back to the city's); without it, hotels aren't graded apart. */
  onHotel?: (code: string, hotel: string, score: CityRatingScore | 0 | undefined) => void;
  /** "Haven't been — I'd try it", on or off; without it, the step doesn't offer it. */
  onUntried?: (code: string, untried: boolean) => void;
  /** Cities graded last month, carried into this pack — said out loud so the pilot checks them. */
  carried?: string[];
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
  return (
    <NoteBox value={value} onChange={onChange} placeholder="Anything else? Favorite restaurant, the bed, friends there… (optional)" ariaLabel={label} />
  );
}

function GradePills({ value, onPick, label, small }: { value: CityRatingScore | 0 | undefined; onPick: (s: CityRatingScore | 0 | undefined) => void; label: string; small?: boolean }) {
  return (
    <div className="grid grid-cols-5 gap-1" role="group" aria-label={label}>
      {CITY_RATING_STEPS.map((step) => {
        const on = value === step.score;
        return (
          <button
            key={step.score}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? undefined : step.score)}
            className={`rounded-md border px-1 ${small ? "py-1 text-[11px]" : "py-1.5 text-xs"} font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              on ? GRADE_STYLE[step.score] : "border-border text-ink-muted hover:border-border-strong hover:text-ink"
            }`}
          >
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A city's grade in its seasons, where it differs from its usual one: "an Anchorage layover in the summer is great; in
 * the winter, less great." Winter and summer are the city's own, from its weather — the months are shown so the pilot
 * knows what they're grading — and a pilot can pick months of their own (Honolulu's tourist season).
 */
function SeasonGrades({ code, name, rating, onSeason }: { code: string; name: string; rating: CityRating | undefined; onSeason: (season: "winter" | "summer" | "months", value: { score: CityRatingScore | 0; months?: number[] } | undefined) => void }) {
  const months = seasonMonths(code);
  const seasons = rating?.seasons;
  const picked = seasons?.months?.months ?? [];
  const [pickedDraft, setPickedDraft] = useState<number[]>(picked);
  const shownMonths = picked.length ? picked : pickedDraft;
  const toggleMonth = (m: number) => {
    const next = shownMonths.includes(m) ? shownMonths.filter((x) => x !== m) : [...shownMonths, m];
    setPickedDraft(next);
    if (seasons?.months) onSeason("months", next.length ? { score: seasons.months.score, months: next } : undefined);
  };
  const row = (title: string, when: string, value: CityRatingScore | 0 | undefined, onPick: (s: CityRatingScore | 0 | undefined) => void) => (
    <div>
      <p className="mb-1 text-xs text-ink-muted">
        <span className="font-medium text-ink">{title}</span> {when}
      </p>
      <GradePills value={value} onPick={onPick} label={`${name} in ${title.toLowerCase()}`} small />
    </div>
  );
  return (
    <div className="mt-2 space-y-3 rounded-md border border-hairline bg-canvas/40 p-2.5">
      {months?.summer.length ? row("Summer", `· ${monthsWords(months.summer)} there`, seasons?.summer, (s) => onSeason("summer", s === undefined ? undefined : { score: s })) : null}
      {months?.winter.length ? (
        row("Winter", `· ${monthsWords(months.winter)}, when most nights freeze`, seasons?.winter, (s) => onSeason("winter", s === undefined ? undefined : { score: s }))
      ) : months ? (
        <p className="text-xs text-ink-faint">No winter to speak of here &mdash; nights rarely freeze.</p>
      ) : null}
      <div>
        <p className="mb-1 text-xs text-ink-muted">
          <span className="font-medium text-ink">Months you pick</span> · a tourist season, say
        </p>
        <div className="mb-1.5 grid grid-cols-6 gap-1 sm:grid-cols-12" role="group" aria-label={`Months for ${name}`}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const on = shownMonths.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMonth(m)}
                className={`rounded border px-1 py-1 text-[11px] transition-colors ${on ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong"}`}
              >
                {monthName(m)}
              </button>
            );
          })}
        </div>
        {shownMonths.length > 0 && <GradePills value={seasons?.months?.score} onPick={(s) => onSeason("months", s === undefined ? undefined : { score: s, months: shownMonths })} label={`${name} in ${monthsWords(shownMonths)}`} small />}
      </div>
    </div>
  );
}

/**
 * A city's hotels graded apart from it, where the pack uses more than one: the same city can be a different layover in a
 * different part of town ("a long layover away from Oakland … would make it much better"). A hotel left ungraded takes
 * the city's grade.
 */
function HotelGrades({ facts, name, rating, onHotel }: { facts: CityFacts; name: string; rating: CityRating | undefined; onHotel: (hotel: string, score: CityRatingScore | 0 | undefined) => void }) {
  return (
    <ul className="mt-2 space-y-2.5 rounded-md border border-hairline bg-canvas/40 p-2.5">
      {facts.hotels.map((h) => (
        <li key={h.name}>
          <p className="mb-1 text-xs text-ink-muted">
            <span className="font-medium text-ink">{h.name}</span> · {h.stays} {h.stays === 1 ? "stay" : "stays"}
            {rating?.hotels?.[h.name] === undefined && <span className="text-ink-faint"> · as the city</span>}
          </p>
          <GradePills value={rating?.hotels?.[h.name]} onPick={(s) => onHotel(h.name, s)} label={`${name}, ${h.name}`} small />
        </li>
      ))}
    </ul>
  );
}

function CityRow({
  facts,
  score,
  rating,
  onRate,
  onReasons,
  onNote,
  onSeason,
  onHotel,
  onUntried,
}: {
  facts: CityFacts;
  score: CityRatingScore | 0;
  rating: CityRating | undefined;
  onRate: (s: CityRatingScore | 0) => void;
  onReasons: (r: CityReasonTag[]) => void;
  onNote: (n: string) => void;
  onSeason?: (season: "winter" | "summer" | "months", value: { score: CityRatingScore | 0; months?: number[] } | undefined) => void;
  onHotel?: (hotel: string, score: CityRatingScore | 0 | undefined) => void;
  onUntried?: (untried: boolean) => void;
}) {
  const name = airportCityName(facts.code);
  const seasonal = hasSeasons(rating?.seasons);
  const [seasonsOpen, setSeasonsOpen] = useState(seasonal);
  const hotelsGraded = Object.keys(rating?.hotels ?? {}).length > 0;
  const [hotelsOpen, setHotelsOpen] = useState(hotelsGraded);
  // A neutral city's note box stays while it's being typed in, even once emptying the note leaves nothing else said.
  const [writingNote, setWritingNote] = useState(false);
  const untried = !!rating?.untried;
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

      <div className="mt-2">
        <GradePills value={untried ? undefined : score} onPick={(s) => onRate(s ?? 0)} label={`Rate ${name ?? facts.code}`} />
      </div>
      {onUntried && (score === 0 || untried) && (
        <button
          type="button"
          aria-pressed={untried}
          onClick={() => onUntried(!untried)}
          className={`mt-1.5 mr-3 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${untried ? "border-accent bg-accent-soft text-accent" : "border-border text-ink-muted hover:border-border-strong"}`}
        >
          Haven&rsquo;t been &mdash; I&rsquo;d try it
        </button>
      )}
      {onHotel && facts.hotels.length >= 2 && (
        <>
          <button
            type="button"
            aria-expanded={hotelsOpen}
            onClick={() => setHotelsOpen((o) => !o)}
            className="mt-1.5 mr-3 text-xs text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            {hotelsGraded ? `Its ${facts.hotels.length} hotels${hotelsOpen ? "" : " ▸"}` : hotelsOpen ? `Its ${facts.hotels.length} hotels` : `${facts.hotels.length} hotels here — grade them apart? ▸`}
          </button>
          {hotelsOpen && <HotelGrades facts={facts} name={name ?? facts.code} rating={rating} onHotel={onHotel} />}
        </>
      )}
      {onSeason && (
        <>
          <button
            type="button"
            aria-expanded={seasonsOpen}
            onClick={() => setSeasonsOpen((o) => !o)}
            className="mt-1.5 text-xs text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            {seasonal ? `Changes with the season${seasonsOpen ? "" : " ▸"}` : seasonsOpen ? "Changes with the season" : "Changes with the season? ▸"}
          </button>
          {seasonsOpen && <SeasonGrades code={facts.code} name={name ?? facts.code} rating={rating} onSeason={onSeason} />}
        </>
      )}

      {score !== 0 ? (
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
      ) : (
        (saysMore(rating) || writingNote) && (
          <div className="mt-3" onFocus={() => setWritingNote(true)} onBlur={() => setWritingNote(false)}>
            <CityNote value={rating?.note ?? ""} onChange={onNote} label={`Note on ${name ?? facts.code}`} />
          </div>
        )
      )}
    </li>
  );
}

/**
 * Every grade given so far, by city name, best first — a last look before moving on. Neighbouring cards are easy to
 * mix up (El Paso sits right above Newark in a Memphis pack), and a grade on the wrong card silently scores the wrong
 * city; spelled out by name, "Dislike: El Paso" stands out to a pilot who meant Newark.
 */
function RatedSummary({ cities, scoreOf, untried }: { cities: CityFacts[]; scoreOf: (code: string) => CityRatingScore | 0; untried: (code: string) => boolean }) {
  const groups = [
    ...[...CITY_RATING_STEPS]
      .filter((s) => s.score !== 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => ({ score: s.score as number, label: s.label, names: cities.filter((c) => scoreOf(c.code) === s.score).map((c) => airportCityName(c.code) ?? c.code) })),
    { score: 0, label: "Would try", names: cities.filter((c) => untried(c.code)).map((c) => airportCityName(c.code) ?? c.code) },
  ].filter((g) => g.names.length > 0);
  if (!groups.length) return null;
  return (
    <div role="group" className="mt-4 rounded-lg border border-border bg-surface-raised px-3 py-2.5" aria-label="Your city ratings">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">Your ratings — check they&rsquo;re on the right cities</p>
      <dl className="mt-1.5 space-y-1 text-sm">
        {groups.map((g) => (
          <div key={g.score} className="flex gap-2">
            <dt className={`w-16 shrink-0 font-medium ${g.score > 0 ? "text-good" : g.score === 0 ? "text-accent" : g.score === -1 ? "text-warn" : "text-danger"}`}>{g.label}</dt>
            <dd className="text-ink">{g.names.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
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
export function CityRatingStep({ cities, ratings, sentiments, onRate, onReasons, onNote, onSeason, onHotel, onUntried, carried = [], eyebrow, fromStory = [], homeCity }: CityRatingStepProps) {
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
        {carried.length > 0 && (
          <p className="mb-3 rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-2 text-xs text-ink-muted">
            <span className="font-medium text-accent">From last month:</span> {carried.map((c) => airportCityName(c) ?? c).join(", ")} &mdash; your
            grades carry over; change any that aren&rsquo;t right anymore.
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
              onSeason={onSeason ? (season, value) => onSeason(c.code, season, value) : undefined}
              onHotel={onHotel ? (hotel, score) => onHotel(c.code, hotel, score) : undefined}
              onUntried={onUntried ? (u) => onUntried(c.code, u) : undefined}
            />
          ))}
        </ul>
        <RatedSummary cities={cities} scoreOf={scoreOf} untried={(code) => !!ratings[code]?.untried} />
      </RevealControls>

      {cities.length === 0 && (
        <p className="mt-4 text-sm text-ink-faint">
          No layover cities to show yet &mdash; this step will be more useful once your bid pack has verified trip-by-trip data.
        </p>
      )}
    </div>
  );
}
