import { createHash } from "node:crypto";
import { decodeRanking, encodeRanking } from "@/lib/forecast/ranking-codec";
import type { KnownRanking } from "@/lib/forecast/simulate";
import { getJson, setJson } from "@/lib/server/kv";

/**
 * The rankings pilots have shared, per seat and month — what lets the forecast
 * stop guessing about the pilots ahead of you. Nothing here is ever returned to
 * a client: the server reads it to run the forecast and sends back only
 * probabilities, so no pilot can look up what another one wants. A pilot is
 * stored under a one-way hash of their account id, and by their place in bid
 * order (a number from the bid pack's own list), never a name.
 */

interface Entry {
  /** One-way hash of the account. */
  u: string;
  /** Bid position. */
  b: number;
  /** Seniority number. */
  s: number;
  /** Encoded ranking (see ranking-codec). */
  r: string;
  /** Last updated, ms. */
  t: number;
}

interface Blob {
  v: 1;
  /** The pack's line numbers in the order rankings are encoded against. */
  lines: string[];
  entries: Entry[];
}

const MAX_ENTRIES = 4000;

export function blobKey(packKey: string, lineNumbers: string[]): string {
  return `line-select:forecast:${packKey}:${lineNumbers.length}:${lineNumbers[0] ?? ""}-${lineNumbers[lineNumbers.length - 1] ?? ""}`;
}

export function hashUser(userId: string): string {
  return createHash("sha256").update(`line-select-forecast:${userId}`).digest("hex").slice(0, 20);
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Everyone's shared rankings for this pack except the asking pilot's own, as line indices. Empty when nothing's stored or the stored line set differs. */
export async function loadKnownRankings(packKey: string, lineNumbers: string[], excludeUserId: string | null): Promise<{ known: KnownRanking[]; total: number }> {
  const blob = await getJson<Blob>(blobKey(packKey, lineNumbers));
  if (!blob || blob.v !== 1 || !sameLines(blob.lines, lineNumbers)) return { known: [], total: 0 };
  const me = excludeUserId ? hashUser(excludeUserId) : null;
  const others = blob.entries.filter((e) => e.u !== me);
  return { known: others.map((e) => ({ bidNumber: e.b, ranking: decodeRanking(e.r, lineNumbers.length) })), total: blob.entries.length };
}

export type SaveResult = { stored: true } | { stored: false; reason: "position-taken" | "store-full" };

/** Saves (or replaces) a pilot's shared ranking. One pilot per bid position: a different account can't take over a position that's already been claimed. */
export async function saveSubmission(params: {
  packKey: string;
  lineNumbers: string[];
  userId: string;
  bidNumber: number;
  seniority: number;
  ranking: number[];
}): Promise<SaveResult> {
  const key = blobKey(params.packKey, params.lineNumbers);
  const existing = await getJson<Blob>(key);
  const blob: Blob = existing && existing.v === 1 && sameLines(existing.lines, params.lineNumbers) ? existing : { v: 1, lines: params.lineNumbers, entries: [] };
  const user = hashUser(params.userId);

  const mine = blob.entries.find((e) => e.u === user);
  const claimedByOther = blob.entries.some((e) => e.b === params.bidNumber && e.u !== user);
  if (claimedByOther) return { stored: false, reason: "position-taken" };
  if (!mine && blob.entries.length >= MAX_ENTRIES) return { stored: false, reason: "store-full" };

  const entry: Entry = { u: user, b: params.bidNumber, s: params.seniority, r: encodeRanking(params.ranking, params.lineNumbers.length), t: Date.now() };
  blob.entries = mine ? blob.entries.map((e) => (e.u === user ? entry : e)) : [...blob.entries, entry];
  await setJson(key, blob);
  return { stored: true };
}

/** Removes a pilot's shared ranking (when they clear their data). */
export async function removeSubmission(packKey: string, lineNumbers: string[], userId: string): Promise<void> {
  const key = blobKey(packKey, lineNumbers);
  const blob = await getJson<Blob>(key);
  if (!blob) return;
  const user = hashUser(userId);
  await setJson(key, { ...blob, entries: blob.entries.filter((e) => e.u !== user) });
}
