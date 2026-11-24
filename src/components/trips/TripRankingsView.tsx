"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditHours } from "@/components/results/TripMarks";
import { ScoreRing } from "@/components/results/ScoreRing";
import { TripList } from "@/components/results/TripList";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { ArrowUpIcon, ChevronDownIcon, GripIcon } from "@/components/ui/icons";
import { TextField } from "@/components/ui/TextField";
import { carryOverWords, tripCarryInPack } from "@/lib/bid-month";
import { tripDateLabel, tripRoute } from "@/lib/brain/line-text";
import { withModel } from "@/lib/brain/profile-model";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { bidMonthOf, cityMarks } from "@/lib/city-ratings";
import { cachedFlightAnswers } from "@/lib/flights/client";
import { FREE_PREVIEW_LINES } from "@/lib/membership";
import { rankingSnapshotFor } from "@/lib/ranking-snapshot";
import { nextVisibleCount, PAGE_SIZE } from "@/lib/results-list";
import { measuredPack, rankingPack } from "@/lib/scoring-v2/adapter";
import { scoreTripsV2, type TripScore } from "@/lib/scoring-v2/trip-score";
import { swapKeyboardCoordinates } from "@/lib/swap-keyboard";
import { placeTrips, rankShifts, tripMovesHere, tripRelocationChoices, withoutTripMove } from "@/lib/trip-moves";
import { rankTrips, tripRowLabel, type RankedTrip } from "@/lib/trip-rankings";
import type { BidPack } from "@/types/bidpack";
import type { TripChoice } from "@/types/pilot-model";
import type { PreferenceProfile } from "@/types/preferences";

interface TripRankingsViewProps {
  bidPack: BidPack;
  profile: PreferenceProfile;
  onEditPreferences: () => void;
  /** Saves a change worked out on the profile as it is by then: a move's refit lands a moment after the move. */
  onUpdateProfileWith: (update: (latest: PreferenceProfile) => PreferenceProfile) => void;
  /** No membership: only the trips their top lines fly, the lines My Rankings shows them (`rankingSnapshotFor`). */
  rankedLinesOnly?: boolean;
}

/** How long after the last move the ranking refits: a run of moves is learned from once, not once each. */
const REFIT_DELAY_MS = 700;
/** Room above and below a trip, in pixels, where letting go still counts as on it — the gap between rows included. */
const DROP_SLACK_PX = 24;

/**
 * Every trip in the pack, best first, the way My Rankings lists lines: each trip's score for this pilot (the Trip Index,
 * `rankTrips`), its number, dates, length and route, and the line that flies it — opening to everything a trip shows
 * inside a line on My Rankings. A trip is judged on itself; how trips fit together into a month (departures, time at
 * home, days off) is a line's, and stays on My Rankings. A trip moved up or down stays where the pilot put it, and is
 * learned from as a trip choice (`lib/trip-moves.ts`) — which reaches their lines too, through their trips' scores.
 */
export function TripRankingsView({ bidPack, profile, onEditPreferences, onUpdateProfileWith, rankedLinesOnly = false }: TripRankingsViewProps) {
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
  // A refit's new scores replace the old ones when they're ready; until then the list stays as it was.
  const scoredTrips = ranked && ranked.pack === bidPack ? ranked.trips : null;

  // The pilot's trip choices, kept here as they move trips (the profile gets them with the refit), and the order with
  // their moves on top of the ranking.
  const [tripChoices, setTripChoices] = useState<TripChoice[]>(() => profile.brainInterview?.tripChoices ?? []);
  const choicesRef = useRef(tripChoices);
  const moves = useMemo(() => tripMovesHere(tripChoices, bidPack), [tripChoices, bidPack]);
  const placedOrder = useMemo(() => (scoredTrips ? placeTrips(scoredTrips, moves) : null), [scoredTrips, moves]);
  const trips = placedOrder?.trips ?? null;
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  // The list as the pilot left it with their latest moves, until the refit lands and can be compared with it.
  const learnFrom = useRef<{ model: typeof model; order: string[]; moved: Set<string>; scores: Map<string, number> } | null>(null);
  const [learned, setLearned] = useState<string | null>(null);

  // The refit: the profile as it is by then, with every trip choice so far, its model refitted to them.
  const refitPending = useRef(false);
  const refitTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!model || onLines === null) return;
    const start = window.setTimeout(() => {
      const flights = cachedFlightAnswers(bidPack, model) ?? undefined;
      const scores = scoreTripsV2(bidPack, model, { flights, pack: rankingPack(bidPack, flights) });
      const fresh = rankTrips(bidPack, scores, onLines);
      setRanked({ model, pack: bidPack, trips: fresh });
      // A refit landed: tell the pilot what it did to the rest of their list.
      const from = learnFrom.current;
      if (from && from.model !== model && !refitPending.current) {
        learnFrom.current = null;
        const after = placeTrips(fresh, tripMovesHere(choicesRef.current, bidPack)).trips;
        const rescored = fresh.filter((t) => !from.moved.has(t.key) && Math.abs(t.score.score - (from.scores.get(t.key) ?? t.score.score)) >= 0.5).length;
        setLearned(learnedWords(rankShifts(from.order, after.map((t) => t.key), from.moved), after, rescored));
      }
    });
    return () => window.clearTimeout(start);
  }, [bidPack, model, onLines]);
  const save = useRef(onUpdateProfileWith);
  useEffect(() => {
    save.current = onUpdateProfileWith;
  });
  const refit = useCallback(() => {
    if (refitTimer.current !== null) window.clearTimeout(refitTimer.current);
    refitTimer.current = null;
    if (!refitPending.current) return;
    refitPending.current = false;
    const next = choicesRef.current;
    save.current((latest) => {
      if (!latest.pilotModel) return latest;
      const facts = measuredPack(bidPack);
      const pack = { ...facts, ctx: { ...facts.ctx, flights: cachedFlightAnswers(bidPack, latest.pilotModel) ?? undefined } };
      return withModel(latest, bidPack, { tripChoices: next }, pack).profile;
    });
  }, [bidPack]);
  // Leaving the page before the refit runs still keeps the moves.
  useEffect(() => () => refit(), [refit]);
  const changeChoices = (next: TripChoice[], message: string) => {
    if (scoredTrips) {
      const added = next.filter((c) => !choicesRef.current.includes(c) && !c.kept);
      const moved = new Set([...(learnFrom.current?.moved ?? []), ...added.flatMap((c) => [c.preferred, c.other])]);
      learnFrom.current = {
        model: learnFrom.current?.model ?? model,
        order: placeTrips(scoredTrips, tripMovesHere(next, bidPack)).trips.map((t) => t.key),
        moved,
        scores: learnFrom.current?.scores ?? new Map(scoredTrips.map((t) => [t.key, t.score.score])),
      };
    }
    setLearned(null);
    choicesRef.current = next;
    setTripChoices(next);
    setMoveMessage(message);
    refitPending.current = true;
    if (refitTimer.current !== null) window.clearTimeout(refitTimer.current);
    refitTimer.current = window.setTimeout(refit, REFIT_DELAY_MS);
  };
  const nameOf = (t: RankedTrip) => `trip ${t.trip.pairingNumber ?? ""}`.trim();
  // One place up or down, or straight to a place: every trip it passes is a choice.
  const move = (from: number, to: number) => {
    if (!trips || to === from || to < 0 || to >= trips.length) return;
    const moved = trips[from];
    const moveId = `trip-move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const passed = Math.abs(to - from);
    const said =
      passed === 1
        ? `Moved ${nameOf(moved)} ${to < from ? "above" : "below"} ${nameOf(trips[to])}.`
        : `Moved ${nameOf(moved)} ${to < from ? "up" : "down"} to #${to + 1}, past ${passed} trips.`;
    changeChoices([...choicesRef.current, ...tripRelocationChoices(trips.map((t) => t.key), from, to, moveId, bidPack.id)], `${said} It stays there, and your trip ranking learns from it.`);
  };
  const moveCount = new Set(moves.map((m) => m.moveId)).size;
  const undoMove = () => {
    const last = moves[moves.length - 1];
    if (!last?.moveId) return;
    changeChoices(withoutTripMove(choicesRef.current, last.moveId), "Took back your last move.");
  };

  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Each trip's place as shown: its place in the list with the pilot's moves in — or, on a non-member's shortened list,
  // its place among every trip in the pack.
  const rankOf = useMemo(() => new Map((trips ?? []).map((t, i) => [t.key, preview ? t.rank : i + 1])), [trips, preview]);
  const filtered = useMemo(() => {
    const q = search.trim().replace(/^#/, "");
    return (trips ?? []).filter((t) => !q || (t.trip.pairingNumber ?? "").startsWith(q));
  }, [trips, search]);
  const displayed = filtered.slice(0, shown);
  // Moving goes by the whole list, so it's offered while every trip shows in order (not on a non-member's top lines).
  const canMove = !!trips && !preview && filtered.length === trips.length;
  // Each trip's score as the Trip Index, for the trip's own drop-down.
  const indexScores = useMemo(() => new Map<string, TripScore>((trips ?? []).map((t) => [t.key, t.score])), [trips]);
  const homeBaseOffsetMinutes = useMemo(() => computeHomeBaseOffsetMinutes(bidPack), [bidPack]);
  const marks = useMemo(() => cityMarks(profile.cityRatings, profile.cityPreferences, bidMonthOf(bidPack)), [profile.cityRatings, profile.cityPreferences, bidPack]);
  const flights = useMemo(() => (model && typeof window !== "undefined" ? cachedFlightAnswers(bidPack, model) : null), [bidPack, model]);

  // Dragging a trip by its grip and letting go on another puts it in that trip's place, as "Move to #" does.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const sensors = useSensors(
    // A plain tap on a trip opens it; only a real movement starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // From the keyboard, Up and Down step to the trip above or below, and Space puts it there.
    useSensor(KeyboardSensor, { coordinateGetter: swapKeyboardCoordinates })
  );
  const dragSpeech = useMemo(() => {
    const say = (id: string | number | undefined) => {
      const t = id === undefined ? undefined : (trips ?? []).find((x) => x.key === String(id));
      return t ? `${nameOf(t)}, number ${rankOf.get(t.key)}` : "a trip";
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => `Picked up ${say(active.id)}. Up and down arrows choose where it goes, Space puts it there, Escape cancels.`,
      onDragOver: ({ active, over }) => (over && over.id !== active.id ? `Over ${say(over.id)}.` : `Back at ${say(active.id)}.`),
      onDragEnd: ({ active, over }) => (over && over.id !== active.id ? `Put ${say(active.id)} in that place.` : `Put back. ${say(active.id)} hasn't moved.`),
      onDragCancel: ({ active }) => `Cancelled. ${say(active.id)} hasn't moved.`,
    };
    return { announcements, screenReaderInstructions: { draggable: "To move this trip, press Space, use the up and down arrows to choose where it goes, then press Space again. Escape cancels." } };
  }, [trips, rankOf]);
  // Where the finger or mouse is, to check the trip it's let go on is the one under it (see `droppedOnIt`).
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (dragKey === null) return;
    const onMove = (e: PointerEvent | TouchEvent) => {
      const p = "touches" in e ? e.touches[0] : e;
      if (p) pointerAt.current = { x: p.clientX, y: p.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, [dragKey]);
  /**
   * Whether a drop by finger or mouse is on the trip it's let go by: the trips are measured as the drag starts, so one
   * scrolled into view since isn't one the drop can land on — it would go to the nearest measured trip, a screen away.
   */
  const droppedOnIt = (event: DragEndEvent, overKey: string): boolean => {
    if (!(event.activatorEvent instanceof PointerEvent || event.activatorEvent instanceof MouseEvent || (typeof TouchEvent !== "undefined" && event.activatorEvent instanceof TouchEvent))) return true;
    const at = pointerAt.current;
    const row = document.querySelector<HTMLElement>(`[data-trip-key="${CSS.escape(overKey)}"]`);
    if (!row) return false;
    if (!at) return true;
    const r = row.getBoundingClientRect();
    return at.y >= r.top - DROP_SLACK_PX && at.y <= r.bottom + DROP_SLACK_PX;
  };
  const handleDragStart = (event: DragStartEvent) => {
    pointerAt.current = null;
    setDragKey(String(event.active.id));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setDragKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !trips) return;
    if (!droppedOnIt(event, String(over.id))) {
      setMoveMessage("Not moved: let go over a trip to put this one in its place.");
      return;
    }
    const from = trips.findIndex((t) => t.key === active.id);
    const to = trips.findIndex((t) => t.key === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };
  const dragTrip = dragKey ? (trips ?? []).find((t) => t.key === dragKey) ?? null : null;
  const dragRank = dragKey ? rankOf.get(dragKey) ?? null : null;

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
        . The Trip Index spreads this pack&rsquo;s trips over 1&ndash;100: the best trip reads in the high 90s. Drag a trip by
        its handle onto another to put it in that trip&rsquo;s place, or use the arrows or &ldquo;Move to #&rdquo;: it
        stays where you put it, and the ranking learns from it, for your trips and your lines. Moving a trip past several
        at once teaches it the most.
      </p>

      {(moveMessage || moves.length > 0) && (
        <div role="status" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent animate-fade-in">
          <span>
            {moveMessage ?? `You've moved trips ${moveCount === 1 ? "once" : `${moveCount} times`} in this pack.`}
            {learned && <span className="mt-1 block text-ink">{learned}</span>}
          </span>
          {moves.length > 0 && (
            <button type="button" onClick={undoMove} className="shrink-0 font-semibold underline underline-offset-2 hover:text-ink">
              Undo last move
            </button>
          )}
        </div>
      )}

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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setDragKey(null)}
              // Nothing moves until the drop, so every trip's place measured as the drag starts holds for the whole drag.
              measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
              accessibility={dragSpeech}
            >
            <ul className="mt-4 space-y-2">
              {displayed.map((t) => (
                <TripRow
                  key={t.key}
                  ranked={t}
                  rank={rankOf.get(t.key) ?? t.rank}
                  dragRank={dragRank}
                  total={trips.length}
                  placed={placedOrder?.placed.has(t.key) ?? false}
                  onMove={canMove ? (toRank) => move((rankOf.get(t.key) ?? 1) - 1, toRank - 1) : null}
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
              <DragOverlay dropAnimation={null}>
                {dragTrip ? (
                  <div className="flex w-56 cursor-grabbing items-center gap-3 rounded-xl border border-accent bg-surface-raised px-4 py-3 shadow-elevated-lg">
                    <ScoreRing score={dragTrip.score.score} size={36} index />
                    <span className="text-sm font-semibold text-ink">{`Trip ${dragTrip.trip.pairingNumber ?? ""}`.trim()}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
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
function TripRow({
  ranked,
  rank,
  dragRank,
  total,
  placed,
  onMove,
  bidPack,
  open,
  onToggle,
  details,
}: {
  ranked: RankedTrip;
  rank: number;
  /** The place of the trip being dragged, while one is. */
  dragRank: number | null;
  total: number;
  /** Put here by one of the pilot's moves. */
  placed: boolean;
  /** Moves the trip to a place in the list (1 is the top); null while the list is narrowed by a search. */
  onMove: ((toRank: number) => void) | null;
  bidPack: BidPack;
  open: boolean;
  onToggle: () => void;
  details: React.ReactNode;
}) {
  const { trip, line, score } = ranked;
  const carry = useMemo(() => tripCarryInPack(bidPack, trip), [bidPack, trip]);
  const date = tripDateLabel(bidPack, trip.startDayIndex);
  const label = `Trip ${trip.pairingNumber ?? ""}`.trim();
  // The grip is what's dragged; the whole trip is where another can be let go.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: ranked.key, disabled: !onMove });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: ranked.key, disabled: !onMove });
  const dropping = isOver && dragRank !== null && dragRank !== rank;
  // Brought up from below, it goes in above this trip; down from above, below it.
  const edge = dropping ? (dragRank! > rank ? "top-0" : "bottom-0") : null;
  return (
    <li
      ref={setDropRef}
      data-trip-key={ranked.key}
      className={`panel-glass relative overflow-hidden transition-[border-color,opacity] ${open ? "!border-border-strong" : "hover:!border-border-strong"} ${isDragging ? "opacity-40" : ""} ${dropping ? "ring-2 ring-accent" : ""}`}
    >
      {edge && (
        <span aria-hidden className={`pointer-events-none absolute inset-x-0 ${edge} z-10 flex justify-center`}>
          <span className="h-1 w-full bg-accent" />
          <span className={`absolute ${edge === "top-0" ? "top-1.5" : "bottom-1.5"} rounded-full bg-accent px-2 py-0.5 text-2xs font-semibold text-canvas`}>Goes here, #{rank}</span>
        </span>
      )}
      <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
        {onMove && (
          <button
            ref={setDragRef}
            type="button"
            {...attributes}
            {...listeners}
            title="Drag onto another trip to put this one in its place"
            aria-label={`Drag ${label} onto another trip to put it in that place — teaches the ranking what you'd rather fly`}
            className="-ml-1 flex h-11 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-ink-faint transition-colors hover:bg-accent-soft/40 hover:text-accent active:cursor-grabbing"
          >
            <GripIcon className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={tripRowLabel({ ...ranked, rank }, date, carry && carryOverWords(carry), open)}
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
        <span className="flex items-center gap-2">
          {placed && (
            <span
              className="whitespace-nowrap rounded-[2px] border border-accent/50 px-1.5 py-px text-2xs font-semibold leading-[0.75rem] text-accent"
              title="You put this trip here. Its score is still Line Select's own match, so it can sit above a trip with a higher score."
            >
              Your order
            </span>
          )}
          {onMove && (
            <>
              <MoveToButton label={label} rank={rank} total={total} onMove={onMove} />
              <MoveButton label={`Move ${label} up, above #${rank - 1}`} disabled={rank <= 1} onClick={() => onMove(rank - 1)} />
              <MoveButton label={`Move ${label} down, below #${rank + 1}`} disabled={rank >= total} onClick={() => onMove(rank + 1)} down />
            </>
          )}
        </span>
      </div>
      {open && <div className="border-t border-hairline p-3 sm:p-4">{details}</div>}
    </li>
  );
}

/** One of a trip's two move arrows. */
function MoveButton({ label, disabled, onClick, down = false }: { label: string; disabled: boolean; onClick: () => void; down?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-md border border-hairline text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-30 disabled:hover:border-hairline disabled:hover:text-ink-muted"
    >
      <ArrowUpIcon className={`h-4 w-4 ${down ? "rotate-180" : ""}`} />
    </button>
  );
}

/** "Move to #…": a trip straight to a place in the list, past every trip between. */
function MoveToButton({ label, rank, total, onMove }: { label: string; rank: number; total: number; onMove: (toRank: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const target = Number(value);
  const valid = Number.isInteger(target) && target >= 1 && target <= total && target !== rank;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setValue("");
          setOpen(true);
        }}
        className="h-8 whitespace-nowrap rounded-md border border-hairline px-2 text-2xs font-semibold text-ink-muted transition-colors hover:border-border-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Move to #
      </button>
    );
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        setOpen(false);
        onMove(target);
      }}
    >
      <label className="sr-only" htmlFor={`move-to-${label}-${rank}`}>
        Move {label} to place
      </label>
      <span className="text-2xs text-ink-muted" aria-hidden>
        #
      </span>
      <input
        id={`move-to-${label}-${rank}`}
        autoFocus
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={String(Math.max(1, rank - 5))}
        className="h-8 w-14 rounded-md border border-hairline bg-transparent px-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand"
      />
      <button type="submit" disabled={!valid} className="h-8 rounded-md border border-accent/50 px-2 text-2xs font-semibold text-accent disabled:opacity-40">
        Move
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-8 px-1 text-2xs text-ink-muted hover:text-ink">
        Cancel
      </button>
    </form>
  );
}

/** What a refit did to the list, in a sentence (`rankShifts`; `rescored`: other trips whose score moved half a point or more). */
function learnedWords(shift: ReturnType<typeof rankShifts>, after: readonly RankedTrip[], rescored: number): string {
  if (!shift.up && !shift.down) {
    if (rescored) return `Your ranking learned from it: ${rescored} other ${rescored === 1 ? "trip's score" : "trips' scores"} changed, though none changed place.`;
    return "Nothing else moved: the other trips already sit where everything you've told us puts them.";
  }
  const trip = shift.climb ? after.find((t) => t.key === shift.climb!.key) : null;
  const climb = shift.climb && trip && shift.climb.from - shift.climb.to >= 2 ? ` Biggest climb: trip ${trip.trip.pairingNumber ?? ""}, #${shift.climb.from} to #${shift.climb.to}.` : "";
  return `Your ranking learned from it: ${shift.up} ${shift.up === 1 ? "trip" : "trips"} moved up and ${shift.down} down.${climb}`;
}

