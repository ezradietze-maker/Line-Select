import { monthAnchorZulu } from "@/lib/pdf-parser/build-bidpack";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { backfillDeadheads } from "@/lib/deadhead";
import { backfillStandby } from "@/lib/standby";
import { anchorTripToItsDate } from "@/lib/trip-anchor";
import type { BidPack, Trip, TripDutyPeriod } from "@/types/bidpack";
import { moveKeptUnderOldId, withCurrentPackId } from "@/lib/pack-id";

function bidPackKey(userId: string | null): string {
  return userId ? `line-select:bidpack:${userId}:v1` : "line-select:bidpack:guest:v1";
}

/** When this device last saved its pack — set beside it, so a newer one saved to the account from another device can be told apart from an older one. */
function savedAtKey(userId: string | null): string {
  return `${bidPackKey(userId)}:saved-at`;
}

/** `anchorMs` is the anchor already read (`Date.parse`): read once per trip, not once per leg time, on a pack load. */
function zuluAt(anchorMs: number, minutes: number): string {
  return new Date(anchorMs + minutes * 60_000).toISOString();
}

/** Backfills a trip saved before the Zulu/Local toggle existed — same anchor-plus-elapsed-minutes math `build-bidpack.ts` uses for a freshly-parsed trip, just applied after the fact using the bid pack's own saved month. */
function backfillZuluFields(trip: Trip, bidPackMonth: string): Trip {
  // A trip with its own anchor just needs any left-out per-leg timestamps rebuilt from it (see `compactBidPack`); one without an anchor predates the Zulu toggle entirely and gets the month's.
  const anchor = trip.zuluAnchor || monthAnchorZulu(bidPackMonth);
  const anchorMs = Date.parse(anchor);
  const schedule: TripDutyPeriod[] = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => ({
      ...leg,
      depTimeZulu: leg.depTimeZulu ?? zuluAt(anchorMs, leg.startMinutes),
      arrTimeZulu: leg.arrTimeZulu ?? zuluAt(anchorMs, leg.endMinutes),
    })),
  }));
  return { ...trip, schedule, zuluAnchor: anchor };
}

/**
 * Pins a saved trip to its own real date. Packs saved before trips were
 * anchored that way carry an anchor on the 1st of the month, which draws a
 * trip on the far side of a daylight-saving change an hour off its printed
 * local times (see `trip-anchor.ts`); re-anchoring here fixes them without a
 * re-upload. A merged run of one-day trips keeps its days' spacing.
 */
function anchorStored(pack: BidPack, trip: Trip): Trip {
  return pack.base ? anchorTripToItsDate(pack, trip) : trip;
}

/**
 * Backfills fields that didn't exist yet when a bid pack was saved (same
 * reasoning as `normalizeProfile` in storage.ts) — a bid pack saved by an
 * older version of the app shouldn't crash the newer one just because a
 * trip predates a field like `layoverDetails`.
 */
function normalizeBidPack(stored: BidPack): BidPack {
  const parsed = withCurrentPackId(stored);
  const restored = (trip: Trip): Trip =>
          anchorStored(parsed, backfillDeadheads(backfillStandby(backfillZuluFields(
            {
              ...trip,
              layoverDetails: trip.layoverDetails ?? [],
              schedule: trip.schedule ?? [],
              pairingNumber: trip.pairingNumber ?? null,
              // Departures are landings — a trip saved when they were counted another way (duty periods, or with standby days mixed in) is corrected here.
              departures: trip.landings,
              // Saved before duty periods were tracked as their own number: the old "departures" was exactly this count (layovers + 1), so rebuild it from the trip itself.
              dutyPeriods: trip.dutyPeriods ?? (trip.layoverDetails?.length ?? 0) + 1,
            },
            parsed.month
          ))));
  return {
    ...parsed,
    ...(parsed.openPairings ? { openPairings: parsed.openPairings.map(restored) } : {}),
    lines: parsed.lines.map((line) => {
      const trips = line.trips.map(restored);
      return {
        ...line,
        trips,
        // Always the sum of the (possibly just-corrected) trips, never a stored total that may predate a change to how departures are counted.
        totalDepartures: trips.reduce((s, t) => s + t.departures, 0),
        totalDutyPeriods: line.totalDutyPeriods ?? trips.reduce((s, t) => s + tripDutyPeriods(t), 0),
      };
    }),
  };
}

/**
 * What's actually written to the browser. A parsed pack repeats every
 * pairing once for each line that flies it (a busy pack has the same trip in
 * dozens of lines) and carries a full ISO timestamp on every leg that's just
 * the trip's anchor plus its elapsed minutes. Stored as-is, the biggest real
 * packs came to 4.5MB — right at a browser's roughly 5MB limit, where a save
 * that failed silently meant the pilot's pack vanished on the next refresh.
 * So each distinct trip is written once and lines point at it, and the
 * derivable timestamps are left out and rebuilt on load.
 */
interface CompactPack extends Omit<BidPack, "lines" | "openPairings"> {
  format: 2;
  tripTable: Record<string, Trip>;
  openPairings?: { ref: string; startDayIndex: number | null }[];
  lines: (Omit<BidPack["lines"][number], "trips"> & { trips: { ref: string; startDayIndex: number | null }[] })[];
}

/** A trip without what loading rebuilds: each leg's instants, and — for a trip the grid dated — its anchor, which comes back from its date (see `anchorStored`), so every run of a pairing is stored once. */
function withoutDerivedZulu(trip: Trip, dated = false): Trip {
  if (!trip.zuluAnchor && !dated) return trip;
  return {
    ...trip,
    ...(dated ? { zuluAnchor: "" } : {}),
    schedule: trip.schedule.map((duty) => ({
      ...duty,
      legs: duty.legs.map((leg) => {
        const { depTimeZulu: _dep, arrTimeZulu: _arr, ...rest } = leg;
        void _dep;
        void _arr;
        return rest as typeof leg;
      }),
    })),
  };
}

export function compactBidPack(pack: BidPack): CompactPack {
  const tripTable: Record<string, Trip> = {};
  const compactTrip = (owner: string) => (trip: Trip, i: number) => {
    const { startDayIndex, ...rest } = trip;
    const stored = withoutDerivedZulu({ ...rest, startDayIndex: null }, startDayIndex !== null && !!pack.bidPeriodStart && !!pack.base);
    // Same id, different content (a layover whose hotel changes with the trip's date) is kept under its own key rather than losing data.
    let key = trip.id;
    const existing = tripTable[key];
    if (existing && JSON.stringify(existing) !== JSON.stringify(stored)) key = `${trip.id}#${owner}#${i}`;
    tripTable[key] ??= stored;
    return { ref: key, startDayIndex };
  };
  const lines = pack.lines.map((line) => ({ ...line, trips: line.trips.map(compactTrip(line.id)) }));
  const { openPairings, ...rest } = pack;
  return { ...rest, ...(openPairings ? { openPairings: openPairings.map(compactTrip("open")) } : {}), format: 2, tripTable, lines };
}

function isCompact(value: unknown): value is CompactPack {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === 2;
}

export function expandBidPack(stored: BidPack | CompactPack): BidPack {
  if (!isCompact(stored)) return stored;
  const { tripTable, format: _format, lines, openPairings, ...rest } = stored;
  void _format;
  return {
    ...rest,
    ...(openPairings ? { openPairings: openPairings.map(({ ref, startDayIndex }) => ({ ...tripTable[ref], startDayIndex })) } : {}),
    lines: lines.map((line) => ({
      ...line,
      trips: line.trips.map(({ ref, startDayIndex }) => ({ ...tripTable[ref], startDayIndex })),
    })),
  } as BidPack;
}

/** A stored pack exactly as the app loads it (expanded, with every left-out field rebuilt) — for scripts working outside the browser. */
export function restoreBidPack(stored: BidPack | CompactPack): BidPack {
  return normalizeBidPack(expandBidPack(stored));
}

/**
 * How a pack is written to the browser: the compact pack gzipped, as base64 behind a marker. The biggest real pack is
 * about 4.2 million characters compacted, four-fifths of the roughly 5 million a browser allows a site, so with the
 * pilot's profile and looked-up flights beside it the small saves after it (a tier move, a star, a swap, the sort) were
 * refused and gone on the next load. Gzipped it's a small fraction of that, and base64 is plain ASCII, which no browser
 * counts double. Packs written before (plain JSON, compact or not) still load, and are rewritten this way when they do.
 */
const GZIP_MARK = "gz1:";

async function gzipToText(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // In slices: a whole pack's bytes spread into one call is more arguments than a browser takes.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return GZIP_MARK + btoa(binary);
}

async function gunzipText(stored: string): Promise<string> {
  const binary = atob(stored.slice(GZIP_MARK.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** The text a pack is stored as: gzipped where the browser can, plain JSON where it can't (as every pack was before). */
async function encodePack(pack: BidPack): Promise<string> {
  const json = JSON.stringify(compactBidPack(pack));
  return typeof CompressionStream === "undefined" ? json : gzipToText(json);
}

/**
 * Compressing takes a moment, so each key's reads and writes run one after another in the order they were asked for: a
 * pack saved while an older one is still being written is the one kept, and a load never reads half a write. Clearing
 * is instant, so a write still waiting from before a clear checks it wasn't cleared since (`cleared`).
 */
const queues = new Map<string, Promise<unknown>>();
const cleared = new Map<string, number>();

function inTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  queues.set(key, run.catch(() => undefined));
  return run;
}

/** Writes the pack unless its key was cleared after `asOf`; false when the browser refused it. */
async function writePack(userId: string | null, pack: BidPack, asOf: number, stamp: boolean): Promise<boolean> {
  const key = bidPackKey(userId);
  try {
    const text = await encodePack(pack);
    // Started over (or signed out) while this waited: the pack isn't wanted here any more.
    if ((cleared.get(key) ?? 0) !== asOf) return true;
    window.localStorage.setItem(key, text);
    if (stamp) window.localStorage.setItem(savedAtKey(userId), String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Resolves false when the browser refused the write (storage full or unavailable), so the caller can tell the pilot their pack won't survive a refresh. */
export function saveBidPack(userId: string | null, bidPack: BidPack): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const key = bidPackKey(userId);
  const asOf = cleared.get(key) ?? 0;
  return inTurn(key, () => writePack(userId, bidPack, asOf, true));
}

export function loadBidPack(userId: string | null): Promise<BidPack | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const key = bidPackKey(userId);
  return inTurn(key, async () => {
    try {
      const asOf = cleared.get(key) ?? 0;
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const gzipped = raw.startsWith(GZIP_MARK);
      const stored = expandBidPack(JSON.parse(gzipped ? await gunzipText(raw) : raw) as BidPack | CompactPack);
      const pack = normalizeBidPack(stored);
      // Saved under the id it had before ids named the aircraft: what the device kept under that id follows it.
      if (pack.id !== stored.id) moveKeptUnderOldId(stored.id, pack.id, userId);
      // Rewritten under its new id, or gzipped if it was saved before packs were, but not re-stamped: it wasn't saved
      // any later than before, and a stamp of "now" would make it look newer than a pack saved to the account since (see
      // `bidPackSavedAt`). If the browser refuses, the copy already there still loads next time.
      if (pack.id !== stored.id || (!gzipped && typeof CompressionStream !== "undefined")) await writePack(userId, pack, asOf, false);
      return pack;
    } catch {
      return null;
    }
  });
}

/** When this device saved its pack (ms); 0 for a pack saved before that was kept, or none. */
export function bidPackSavedAt(userId: string | null): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(savedAtKey(userId))) || 0;
  } catch {
    return 0;
  }
}

export function clearBidPack(userId: string | null): void {
  if (typeof window === "undefined") return;
  cleared.set(bidPackKey(userId), (cleared.get(bidPackKey(userId)) ?? 0) + 1);
  try {
    window.localStorage.removeItem(bidPackKey(userId));
    window.localStorage.removeItem(savedAtKey(userId));
  } catch {
    // ignore
  }
}
