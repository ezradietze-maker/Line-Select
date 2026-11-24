"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CreditHours } from "@/components/results/TripMarks";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { ChevronDownIcon } from "@/components/ui/icons";
import { TextField } from "@/components/ui/TextField";
import { carryOverWords, tripCarryInPack } from "@/lib/bid-month";
import { tripDateLabel, tripRoute } from "@/lib/brain/line-text";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { bidMonthOf, cityMarks } from "@/lib/city-ratings";
import { cachedFlightAnswers } from "@/lib/flights/client";
import { FREE_PREVIEW_LINES } from "@/lib/membership";
import { rankingSnapshotFor } from "@/lib/ranking-snapshot";
import { nextVisibleCount, PAGE_SIZE } from "@/lib/results-list";
import { rankingPack } from "@/lib/scoring-v2/adapter";
import { scoreTripsV2, type TripScore } from "@/lib/scoring-v2/trip-score";
import { rankTrips, tripRowLabel, type RankedTrip } from "@/lib/trip-rankings";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

interface TripRankingsViewProps {
  bidPack: BidPack;
  profile: PreferenceProfile;
  onEditPreferences: () => void;
  /** No membership: only the trips their top lines fly, the lines My Rankings shows them (`rankingSnapshotFor`). */
  rankedLinesOnly?: boolean;
}

/**
 * Every trip in the pack, best first, the way My Rankings lists lines: each trip's score for this pilot (the Trip Index,
 * `rankTrips`), its number, dates, length and route, and the line that flies it — opening to everything a trip shows
 * inside a line on My Rankings. A trip is judged on itself; how trips fit together into a month (departures, time at
 * home, days off) is a line's, and stays on My Rankings.
 */
export function TripRankingsView({ bidPack, profile, onEditPreferences, rankedLinesOnly = false }: TripRankingsViewProps) {
  const model = profile.pilotModel;
  // A non-member's lines are the ones My Rankings worked out for them this visit; none yet until it has.
  const [onLines] = useState(() => {
    if (!rankedLinesOnly) return undefined;
    const snapshot = rankingSnapshotFor(bidPack.id);
    return snapshot ? new Set(snapshot.byLineId.keys()) : null;
  });
  // A pack of ten lines or fewer (the sample's six): their top lines are every line, so the page says what it says to a
  // member, and nothing of a membership — as My Rankings does. It had told a guest on the sample their 9 trips were the
  // trips "on your top 10 lines", and that a membership ranks every trip in the pack.
  const topLines = Math.min(FREE_PREVIEW_LINES, bidPack.lines.length);
  const preview = rankedLinesOnly && !(onLines && onLines.size >= bidPack.lines.length);
  // Scored after the first paint: a pack's trips take a moment, and the page shows its heading meanwhile.
  const [ranked, setRanked] = useState<{ model: typeof model; pack: BidPack; trips: RankedTrip[] } | null>(null);
  useEffect(() => {
    if (!model || onLines === null) return;
    const start = window.setTimeout(() => {
      const flights = cachedFlightAnswers(bidPack, model) ?? undefined;
      const scores = scoreTripsV2(bidPack, model, { flights, pack: rankingPack(bidPack, flights) });
      setRanked({ model, pack: bidPack, trips: rankTrips(bidPack, scores, onLines) });
    });
    return () => window.clearTimeout(start);
  }, [bidPack, model, onLines]);
  const trips = ranked && ranked.model === model && ranked.pack === bidPack ? ranked.trips : null;

  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => {
    const q = search.trim().replace(/^#/, "");
    return (trips ?? []).filter((t) => !q || (t.trip.pairingNumber ?? "").startsWith(q));
  }, [trips, search]);
  const displayed = filtered.slice(0, shown);
  // Each trip's score as the Trip Index, for the trip's own drop-down.
  const indexScores = useMemo(() => new Map<string, TripScore>((trips ?? []).map((t) => [t.key, t.score])), [trips]);
  const homeBaseOffsetMinutes = useMemo(() => computeHomeBaseOffsetMinutes(bidPack), [bidPack]);
  const marks = useMemo(() => cityMarks(profile.cityRatings, profile.cityPreferences, bidMonthOf(bidPack)), [profile.cityRatings, profile.cityPreferences, bidPack]);
  const flights = useMemo(() => (model && typeof window !== "undefined" ? cachedFlightAnswers(bidPack, model) : null), [bidPack, model]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0">
          <div className="text-2xs font-medium text-accent">
            {bidPack.base} &middot; {bidPack.aircraft} &middot; {bidPack.seat} &middot; {bidPack.month}
          </div>
          <Heading as="h1" className="mt-1.5 text-3xl text-ink sm:text-4xl">
            Your ranked trips
          </Heading>
          <p className="mt-1.5 text-sm text-ink-muted">
            {preview
              ? `${trips ? `${trips.length} trips` : "The trips"} on your top ${FREE_PREVIEW_LINES} lines, scored against what you told us`
              : `${trips ? `${trips.length} trips` : "Every trip"} scored against what you told us`}
            <span className="hidden sm:inline"> &middot; best match first</span>
          </p>
        </div>
        <Button variant="secondary" onClick={onEditPreferences} className="shrink-0 px-3 sm:px-4">
          <span className="sm:hidden">Edit</span>
          <span className="hidden sm:inline">Edit preferences</span>
        </Button>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        Each trip is judged on itself: its layovers, its flying, its pay, how it starts and ends. How trips fit together into
        a month (how often you leave home, your time at home, your days off) is a line&rsquo;s, so it&rsquo;s on{" "}
        <Link href="/results" className="text-ink underline decoration-dotted underline-offset-4 hover:text-accent">
          My Rankings
        </Link>
        . The Trip Index spreads this pack&rsquo;s trips over 1&ndash;100: the best trip reads in the high 90s.
      </p>

      {!model ? (
        <p className="mt-8 text-sm text-ink-muted">Finish your preferences first, and your trips will be ranked here.</p>
      ) : onLines === null ? (
        <p className="mt-8 text-sm text-ink-muted">
          Your trips are ranked from your top {topLines} lines. Open{" "}
          <Link href="/results" className="text-ink underline decoration-dotted underline-offset-4 hover:text-accent">
            My Rankings
          </Link>{" "}
          first, and they show here.
        </p>
      ) : (
        <>
          <div className="mt-5 max-w-xs">
            <TextField
              label="Find a trip by number"
              inputMode="numeric"
              placeholder="e.g. 311"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShown(PAGE_SIZE);
              }}
            />
          </div>

          {!trips ? (
            <p className="mt-6 text-sm text-ink-muted" role="status">
              Scoring every trip&hellip;
            </p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm text-ink-muted">
              {preview ? `No trip on your top ${FREE_PREVIEW_LINES} lines starts with that number.` : "No trip in this pack starts with that number."}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {displayed.map((t) => (
                <TripRow
                  key={t.key}
                  ranked={t}
                  rank={t.rank}
                  bidPack={bidPack}
                  open={open.has(t.key)}
                  onToggle={() => toggle(t.key)}
                  details={
                    <TripList
                      trips={[t.trip]}
                      homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                      bidPeriodStart={bidPack.bidPeriodStart}
                      cityPreferences={marks}
                      flights={flights}
                      base={bidPack.base}
                      tripScores={indexScores}
                      indexScores
                    />
                  }
                />
              ))}
            </ul>
          )}

          {trips && displayed.length < filtered.length && (
            <div className="mt-5 flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-ink-muted">
                Showing {displayed.length} of {filtered.length} trips &mdash; the best matches first.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => setShown(nextVisibleCount(shown, filtered.length))}>
                  Show {Math.min(PAGE_SIZE, filtered.length - displayed.length)} more
                </Button>
                <Button variant="ghost" onClick={() => setShown(filtered.length)}>
                  Show all {filtered.length}
                </Button>
              </div>
            </div>
          )}

          {preview && trips && (
            <p className="mt-5 text-center text-sm text-ink-muted">
              Those are the trips on your top {FREE_PREVIEW_LINES} lines. A{" "}
              <Link href="/membership" className="text-ink underline decoration-dotted underline-offset-4 hover:text-accent">
                membership
              </Link>{" "}
              ranks every trip in the pack.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One trip in the list: its score and rank, its number and credit, when and how long, where it goes, and its line — tapped open to the trip day by day. */
function TripRow({ ranked, rank, bidPack, open, onToggle, details }: { ranked: RankedTrip; rank: number; bidPack: BidPack; open: boolean; onToggle: () => void; details: React.ReactNode }) {
  const { trip, line, score } = ranked;
  const carry = useMemo(() => tripCarryInPack(bidPack, trip), [bidPack, trip]);
  const date = tripDateLabel(bidPack, trip.startDayIndex);
  return (
    <li className={`panel-glass overflow-hidden transition-[border-color] ${open ? "!border-border-strong" : "hover:!border-border-strong"}`}>
      <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={tripRowLabel(ranked, date, carry && carryOverWords(carry), open)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span className="flex shrink-0 flex-col items-center gap-1">
            <ScoreRing score={score.score} size={44} index top={rank === 1} capped={score.violations.length > 0} />
            <span className="font-mono text-2xs font-semibold text-ink-muted">#{rank}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-[3px] bg-calendar-accent px-1.5 py-px font-mono text-xs font-semibold text-on-calendar">
                {trip.pairingNumber !== null ? `#${trip.pairingNumber} ` : ""}
                <CreditHours hours={trip.creditHours} className="font-normal" />
              </span>
              <span className="font-mono text-xs text-ink">{[date, `${trip.days}-day`].filter(Boolean).join(" · ")}</span>
              {trip.international && <span className="rounded-[3px] bg-accent-soft px-1.5 py-0.5 text-2xs font-semibold text-accent">Intl</span>}
              {carry && <span className="font-mono text-xs text-carry">{carryOverWords(carry)}</span>}
            </span>
            <span className="mt-1 block font-mono text-2xs leading-relaxed text-ink-muted [overflow-wrap:anywhere]">{tripRoute(trip)}</span>
          </span>
          <ChevronDownIcon className={`mt-1 h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-1.5 text-2xs text-ink-faint sm:px-4">
        <span>
          On{" "}
          <Link href={`/results?line=${encodeURIComponent(line.lineNumber)}`} className="font-mono text-ink underline decoration-dotted underline-offset-4 hover:text-accent">
            line {line.lineNumber}
          </Link>
        </span>
      </div>
      {open && <div className="border-t border-hairline p-3 sm:p-4">{details}</div>}
    </li>
  );
}
