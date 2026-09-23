"use client";

import { useState } from "react";
import type { CitySentiment } from "@/types/preferences";

/** Search box only appears once the list is long enough that scanning it by eye stops being practical. */
const SEARCH_THRESHOLD = 16;

interface CityChipsProps {
  /** Every layover city to offer, most-visited first — deliberately uncapped, since a pilot's favorite city is often not among the most frequent ones. */
  cities: string[];
  /** Effective sentiment per city code. */
  sentiments: Record<string, CitySentiment | null | undefined>;
  /** Cycles one city: no opinion -> love -> avoid -> no opinion. */
  onCycle: (code: string) => void;
}

function nextLabel(current: CitySentiment | null | undefined): string {
  if (current === "love") return "Tap to mark as avoid";
  if (current === "avoid") return "Tap to clear";
  return "Tap to mark as a favorite";
}

export function CityChips({ cities, sentiments, onCycle }: CityChipsProps) {
  const [query, setQuery] = useState("");
  const showSearch = cities.length > SEARCH_THRESHOLD;
  const q = query.trim().toUpperCase();
  // A city that already has an opinion always stays visible, even mid-search,
  // so a pilot never loses sight of something they've flagged.
  const visible = q ? cities.filter((c) => c.includes(q) || sentiments[c]) : cities;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-good" /> Favorite
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" /> Avoid
        </span>
        <span className="text-ink-faint">Tap a city to cycle: favorite &rarr; avoid &rarr; no opinion</span>
      </div>

      {showSearch && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Find a city (${cities.length} in this pack)`}
          aria-label="Find a layover city"
          className="mt-3 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {visible.map((code) => {
          const sentiment = sentiments[code] ?? null;
          return (
            <button
              key={code}
              type="button"
              onClick={() => onCycle(code)}
              aria-label={`${code}: ${sentiment === "love" ? "favorite" : sentiment === "avoid" ? "avoid" : "no opinion"}. ${nextLabel(sentiment)}`}
              className={`flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-all ${
                sentiment === "love"
                  ? "border-good bg-good-soft text-good"
                  : sentiment === "avoid"
                    ? "border-danger bg-danger-soft text-danger"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink"
              }`}
            >
              {sentiment === "love" && (
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M12 21s-6.7-4.35-9.3-8.1C1.1 10.5 1.6 7.4 4 5.9c2-1.25 4.4-.7 5.7 1 .5.65.9 1.3 1 1.5.1-.2.5-.85 1-1.5 1.3-1.7 3.7-2.25 5.7-1 2.4 1.5 2.9 4.6 1.3 7-2.6 3.75-9.3 8.1-9.3 8.1z" />
                </svg>
              )}
              {sentiment === "avoid" && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" d="M6.5 6.5l11 11" />
                </svg>
              )}
              {code}
            </button>
          );
        })}
        {visible.length === 0 && <p className="text-sm text-ink-faint">No city matches &ldquo;{query}&rdquo;.</p>}
      </div>
    </div>
  );
}
