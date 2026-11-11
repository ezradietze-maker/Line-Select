import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, eq, isNull } from "drizzle-orm";
import { loggedMonthFor } from "@/lib/bid-checklist";
import { expandBidPack } from "@/lib/bidpack-storage";
import { buildFeedMonth, DEFAULT_FEED_OPTIONS, withFeedMonth, type FeedMonth, type FeedOptions, type LineSource } from "@/lib/calendar-feed";
import { travelParamsFor } from "@/lib/flights/client";
import { jumpseatFlights } from "@/lib/flights/jumpseat";
import { travelNeedsForTrip } from "@/lib/flights/needs";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { reportProblem } from "@/lib/server/alerts";
import { getBidPackRecord, getPreferenceProfile } from "@/lib/server/db";
import { answerTravelNeeds, flightDataConfigured } from "@/lib/server/flight-schedules";
import { db } from "@/lib/server/postgres";
import { calendarFeeds } from "@/lib/server/schema";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Pilots' calendar subscriptions. The link's token is 32 random bytes, stored only as a SHA-256 hash: a slow salted hash
 * guards guessable passwords, and this can't be guessed. So the link is shown once, when it's made, and a pilot who
 * loses it makes a new one.
 */

/** Unguessable, and URL-safe as it stands. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isFeedToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

export interface FeedStatus {
  on: boolean;
  createdAt?: string;
  options?: FeedOptions;
  /** The month most recently built, and the line it shows. */
  month?: string | null;
  lineNumber?: string | null;
  lineSource?: LineSource | null;
}

function statusOf(row: typeof calendarFeeds.$inferSelect | undefined): FeedStatus {
  if (!row) return { on: false };
  const latest = [...row.months].sort((a, b) => b.builtAt - a.builtAt)[0];
  return { on: true, createdAt: row.createdAt.toISOString(), options: row.options, month: latest?.month ?? null, lineNumber: latest?.lineNumber ?? null, lineSource: latest?.lineSource ?? null };
}

async function liveFeed(userId: string) {
  const [row] = await db
    .select()
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)))
    .limit(1);
  return row;
}

export async function feedStatus(userId: string): Promise<FeedStatus> {
  return statusOf(await liveFeed(userId));
}

/** A new link, in place of any old one, which stops working at once. What the old one carried and its options carry over. */
export async function startFeed(userId: string, options?: Partial<FeedOptions>): Promise<{ token: string; status: FeedStatus }> {
  const token = randomBytes(32).toString("base64url");
  const old = await liveFeed(userId);
  const row = await db.transaction(async (tx) => {
    if (old) await tx.update(calendarFeeds).set({ revokedAt: new Date(), months: [] }).where(eq(calendarFeeds.id, old.id));
    const [created] = await tx
      .insert(calendarFeeds)
      .values({ userId, tokenHash: hashFeedToken(token), options: { ...DEFAULT_FEED_OPTIONS, ...old?.options, ...options }, months: old?.months ?? [] })
      .returning();
    return created;
  });
  return { token, status: statusOf(row) };
}

/** Turned off: the link stops working, and the trips kept for it go. */
export async function revokeFeed(userId: string): Promise<void> {
  await db
    .update(calendarFeeds)
    .set({ revokedAt: new Date(), months: [] })
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)));
}

export async function setFeedOptions(userId: string, options: Partial<FeedOptions>): Promise<FeedStatus> {
  const row = await liveFeed(userId);
  if (!row) return { on: false };
  const next = { ...row.options, ...options };
  await db.update(calendarFeeds).set({ options: next }).where(eq(calendarFeeds.id, row.id));
  return statusOf({ ...row, options: next });
}

/** What the feed route needs. A revoked or unknown token finds nothing. */
export async function feedForToken(token: string): Promise<{ months: FeedMonth[]; options: FeedOptions } | null> {
  if (!isFeedToken(token)) return null;
  const [row] = await db
    .select({ months: calendarFeeds.months, options: calendarFeeds.options })
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.tokenHash, hashFeedToken(token)), isNull(calendarFeeds.revokedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * The commuter's suggested flights for this line, from departure boards already cached (`maxBoards: 0`): the feed never
 * pays for a lookup. A board that isn't cached just means fewer suggestions, and the feed works without any.
 */
async function cachedCommute(pack: BidPack, lineNumber: string | null, profile: PreferenceProfile | null): Promise<FlightAnswers | undefined> {
  const params = travelParamsFor(pack, profile?.pilotModel);
  const line = pack.lines.find((l) => l.lineNumber === lineNumber);
  if (!params || !line || !flightDataConfigured()) return undefined;
  try {
    const needs = line.trips.flatMap((t) => travelNeedsForTrip(pack, t, params));
    const { answers } = await answerTravelNeeds(needs, jumpseatFlights(pack), { maxBoards: 0 });
    return Object.fromEntries(answers.map((a) => [a.id, a]));
  } catch (e) {
    await reportProblem("calendar-feed", e, { what: "cached commute" });
    return undefined;
  }
}

export interface FeedChoice {
  packId: string;
  lineNumber: string | null;
  lineSource: LineSource | null;
  pilotClose: string | null;
}

export type SyncResult = "off" | "pack-not-saved" | "ok";

/**
 * Rebuilds this month's part of the pilot's feed from their stored pack, when their choice changes in the browser. An
 * award in their account's logbook outranks a #1 from a device that hasn't heard of it yet.
 */
export async function syncFeed(userId: string, choice: FeedChoice, now = Date.now()): Promise<SyncResult> {
  const row = await liveFeed(userId);
  if (!row) return "off";
  const record = await getBidPackRecord(userId);
  if (!record || record.packId !== choice.packId) return "pack-not-saved";
  const pack = expandBidPack(JSON.parse(gunzipSync(record.data).toString("utf8")));
  const profile = await getPreferenceProfile(userId);
  const logged = choice.lineSource === "awarded" ? null : profile ? loggedMonthFor(profile, pack) : null;
  const lineNumber = logged ? (logged.outcome === "line" ? (logged.lineNumber ?? null) : null) : choice.lineNumber;
  const lineSource = logged ? "awarded" : choice.lineSource;
  const flights = await cachedCommute(pack, lineNumber, profile);
  const month = buildFeedMonth(pack, { lineNumber, lineSource, pilotClose: choice.pilotClose, flights, now });
  // A trip with no date to place it on is left off the calendar, which the pilot can't see from there: heard about here.
  const line = lineNumber ? pack.lines.find((l) => l.lineNumber === lineNumber) : null;
  if (lineNumber && (!line || month.trips.length < line.trips.length)) {
    await reportProblem("calendar-feed", new Error("Trips left off a calendar"), { what: "feed build", packId: pack.id, lineNumber, trips: `${month.trips.length} of ${line?.trips.length ?? "no line"}` });
  }
  await db.update(calendarFeeds).set({ months: withFeedMonth(row.months, month) }).where(eq(calendarFeeds.id, row.id));
  return "ok";
}
