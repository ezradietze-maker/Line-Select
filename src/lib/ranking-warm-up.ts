"use client";

import { useEffect, useState } from "react";
import { warmTripBodyClock } from "@/lib/body-clock-score";
import { computeHomeBaseOffsetMinutes } from "@/lib/circadian";
import { lookupPack } from "@/lib/flights/client";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { implicitLineValuesFor } from "@/lib/implicit-dimensions";
import { packColumnCount } from "@/lib/bidpack-row";
import { filterOptionsFor } from "@/lib/line-filter-options";
import { collectLayoverCities, collectTouchedCities } from "@/lib/line-filters";
import { tripFactsOf } from "@/lib/metrics/compute";
import { rankingPack } from "@/lib/scoring-v2/adapter";
import { measureTasks } from "@/lib/scoring-v2/score";
import { scoreTripsV2 } from "@/lib/scoring-v2/trip-score";
import type { BidPack } from "@/types/bidpack";
import type { PilotModel } from "@/types/pilot-model";

/**
 * A pack's first ranking is slow: on the biggest pack and a slowed phone, about two and a half seconds in one piece, the
 * page frozen and blank below its header. Nearly all of it is work done once per pack and kept — every trip's body-clock
 * points (a sleep plan for each layover of some 800 trips), every trip's facts, each of the pilot's measures on every
 * line. This does that work first, a few milliseconds at a time between frames, while the page says it's ranking; the
 * ranking then finds it done. It's the same work into the same caches, so the ranking comes out exactly as before.
 *
 * Looked-up flights change what the measures read, so flights that land later are measured the same way before the
 * ranking takes them, rather than in one long stall the moment they arrive.
 */

/** Work done between frames, at most: under what a phone shows as a stall. */
const SLICE_MS = 30;

/** A piece of the work; it can hand back more pieces, done next (a measure can't be listed until its pack is prepared). */
export type Task = () => void | Task[];

/** Runs every piece at once (for tests and scripts). */
export function runAll(tasks: Task[]): void {
  const queue = [...tasks];
  while (queue.length) {
    const more = queue.shift()!();
    if (more) queue.unshift(...more);
  }
}

/** What's been worked out ahead, by pack: the nights limit and flights it was done for. */
const done = new WeakMap<BidPack, Set<string>>();
const flightIds = new WeakMap<FlightAnswers, number>();
let nextFlightId = 1;
function keyOf(nightsLimit: number | null, flights: FlightAnswers | null) {
  if (flights && !flightIds.has(flights)) flightIds.set(flights, nextFlightId++);
  return `${nightsLimit}|${flights ? flightIds.get(flights) : "none"}`;
}
const isDone = (pack: BidPack, key: string) => !!done.get(pack)?.has(key);

/** Facts the page shows that come from the pack alone, worked out with the rest and kept with the pack. */
const kept = new WeakMap<BidPack, Map<string, unknown>>();
function keptFor<T>(pack: BidPack, name: string, work: () => T): T {
  let facts = kept.get(pack);
  if (!facts) kept.set(pack, (facts = new Map()));
  if (!facts.has(name)) facts.set(name, work());
  return facts.get(name) as T;
}
/** Every layover city, and every airport a leg touches: the filters' choices. */
export const layoverCitiesOf = (pack: BidPack) => keptFor(pack, "layover cities", () => collectLayoverCities(pack.lines));
export const touchedCitiesOf = (pack: BidPack) => keptFor(pack, "touched cities", () => collectTouchedCities(pack.lines));
/** How many day columns the strips take. */
export const columnCountOf = (pack: BidPack) => keptFor(pack, "column count", () => packColumnCount(pack));

/** Every piece of the work, in order (exported for tests: the ranking after them must be the ranking without). */
export function warmUpTasks(bidPack: BidPack, flown: BidPack, model: PilotModel | undefined, nightsLimit: number | null, flights: FlightAnswers | null, measuresOnly = false): Task[] {
  const packs = [...new Set([flown, bidPack])];
  const limits = [...new Set([nightsLimit, null])];
  const tasks: Task[] = [];
  // New flights change only the measures: the trips' points and facts are kept from the first time.
  if (!measuresOnly) for (const pack of packs) {
    let offset: number | null = null;
    tasks.push(() => void (offset = computeHomeBaseOffsetMinutes(pack)));
    for (const line of pack.lines)
      for (const trip of line.trips)
        tasks.push(() => {
          for (const limit of limits) warmTripBodyClock(trip, offset, limit);
          tripFactsOf(trip);
        });
  }
  tasks.push(() => void implicitLineValuesFor(bidPack));
  tasks.push(() => void filterOptionsFor(bidPack.lines, bidPack.bidPeriodStart));
  tasks.push(() => void layoverCitiesOf(bidPack));
  tasks.push(() => void touchedCitiesOf(bidPack));
  tasks.push(() => void columnCountOf(bidPack));
  if (model) {
    const asked = flights ?? undefined;
    // Prepared (one piece: each trip's facts are done by now), then measured a measure at a time — each with these
    // flights set, as the pack's flights are whatever the last ranking set.
    for (const pack of packs)
      tasks.push(() =>
        measureTasks(pack, model, rankingPack(pack, asked)).map((measure) => () => {
          rankingPack(pack, asked);
          measure();
        })
      );
    // The pack the flights lookup picks the best lines on (no flights: they're what it looks up).
    tasks.push(() => measureTasks(bidPack, model, lookupPack(bidPack)));
    // A pilot who graded trips has every trip scored inside the ranking (see `rankLinesWithTrips`).
    if (model.tripWeights && Object.keys(model.tripWeights).length) {
      tasks.push(() => void scoreTripsV2(flown, model, { flights: asked, pack: rankingPack(flown, asked), onLineScale: false }));
      tasks.push(() => void scoreTripsV2(bidPack, model, { pack: lookupPack(bidPack), onLineScale: false }));
    }
  }
  return tasks;
}

/** Runs the pieces between frames; `onShare` hears how far along it is. Returns a stop. */
function runInSlices(tasks: Task[], onShare: (share: number) => void, onDone: () => void): () => void {
  const queue = [...tasks];
  let ran = 0;
  let stopped = false;
  let saidAt = 0;
  // A message to itself: the browser draws a frame and answers a tap between slices, without setTimeout's 4 ms floor.
  const channel = new MessageChannel();
  const slice = () => {
    if (stopped) return;
    const until = performance.now() + SLICE_MS;
    while (queue.length && performance.now() < until) {
      const more = queue.shift()!();
      ran++;
      if (more) queue.unshift(...more);
    }
    if (!queue.length) {
      onDone();
      return;
    }
    const now = performance.now();
    if (now - saidAt > 150) {
      saidAt = now;
      onShare(ran / (ran + queue.length));
    }
    channel.port2.postMessage(null);
  };
  channel.port1.onmessage = slice;
  channel.port2.postMessage(null);
  return () => {
    stopped = true;
    channel.port1.close();
  };
}

/**
 * Whether the page's first ranking can run without stalling (`ready`), how far along the work before it is (`share`,
 * 0–1, for the page to show), and the flights to rank with: `flights` once they've been measured, the ones before
 * until then.
 */
export function useRankingWarmUp(bidPack: BidPack, flown: BidPack, model: PilotModel | undefined, nightsLimit: number | null, flights: FlightAnswers | null) {
  const key = keyOf(nightsLimit, flights);
  const warm = isDone(flown, key);
  // The newest flights the work's been done for (`undefined` before any has).
  const [ranked, setRanked] = useState<{ flights: FlightAnswers | null } | undefined>(() => (warm ? { flights } : undefined));
  const [share, setShare] = useState(0);

  useEffect(() => {
    if (isDone(flown, key)) return;
    const measuresOnly = [...(done.get(flown) ?? [])].some((k) => k.startsWith(`${nightsLimit}|`));
    return runInSlices(warmUpTasks(bidPack, flown, model, nightsLimit, flights, measuresOnly), setShare, () => {
      if (!done.has(flown)) done.set(flown, new Set());
      done.get(flown)!.add(key);
      setRanked({ flights });
    });
    // The model is read when the work starts: a refit changes weights, never what's measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidPack, flown, nightsLimit, flights, key]);

  return { ready: warm || ranked !== undefined, share, flights: warm ? flights : (ranked?.flights ?? null) };
}
