import { NextResponse } from "next/server";
import { reportProblem } from "@/lib/server/alerts";
import type { ScheduledFlight } from "@/lib/flights/itineraries";
import type { TravelNeed } from "@/lib/flights/needs";
import { answerTravelNeeds, boardCostUsd, flightDataConfigured } from "@/lib/server/flight-schedules";
import { isJsonObject } from "@/lib/server/json-body";
import { checkRequestLimit, rateLimitedResponse } from "@/lib/server/rate-limit";
import { checkSpend, recordSpend, spenderFor } from "@/lib/server/spend-guard";

export const runtime = "nodejs";
// The first look at a month's flights fetches a few hundred departure boards; after that it's cached.
export const maxDuration = 300;

const MAX_NEEDS = 600;
const MAX_JUMPSEATS = 4000;
const KINDS = new Set(["toBase", "deviateOut", "homeFromBase", "deviateHome"]);
const code = (x: unknown): x is string => typeof x === "string" && /^[A-Z]{3}$/.test(x);

// A pack's month runs from a few weeks back (a month already flying) to a few months ahead. A need dated outside that
// is left unanswered: its departure board is one nobody has cached, paid for out of the month's allowance.
const PAST_LIMIT_MS = 45 * 24 * 3600_000;
const FUTURE_LIMIT_MS = 150 * 24 * 3600_000;

function readNeeds(value: unknown, now = Date.now()): TravelNeed[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_NEEDS) return null;
  const out: TravelNeed[] = [];
  for (const n of value) {
    if (!isJsonObject(n) || typeof n.id !== "string" || n.id.length > 200 || typeof n.tripId !== "string" || !KINDS.has(n.kind as string)) return null;
    if (!Array.isArray(n.from) || !Array.isArray(n.to) || !n.from.every(code) || !n.to.every(code) || n.from.length > 4 || n.to.length > 4) return null;
    if (
      typeof n.departAfter !== "number" ||
      typeof n.departBefore !== "number" ||
      n.departBefore - n.departAfter > 48 * 3600_000 ||
      n.departBefore < n.departAfter
    )
      return null;
    if (n.departAfter < now - PAST_LIMIT_MS || n.departAfter > now + FUTURE_LIMIT_MS) continue;
    // Bounded like the departure window: every 12 hours of it is another departure board to fetch.
    if (n.arriveBy !== undefined && (typeof n.arriveBy !== "number" || n.arriveBy < n.departAfter || n.arriveBy > n.departBefore + 72 * 3600_000)) return null;
    // Every hub a wider detour lets in is more boards to fetch, so this stays within reason too.
    if (n.maxDetour !== undefined && (typeof n.maxDetour !== "number" || !(n.maxDetour >= 1 && n.maxDetour <= 2))) return null;
    let groundMs: Record<string, number> | undefined;
    if (n.groundMs !== undefined) {
      if (!isJsonObject(n.groundMs)) return null;
      const entries = Object.entries(n.groundMs);
      if (entries.length > 4 || !entries.every(([k, v]) => code(k) && typeof v === "number" && v >= 0 && v <= 6 * 3600_000)) return null;
      groundMs = Object.fromEntries(entries) as Record<string, number>;
    }
    out.push({
      id: n.id,
      tripId: n.tripId,
      kind: n.kind as TravelNeed["kind"],
      from: n.from as string[],
      to: n.to as string[],
      departAfter: n.departAfter,
      departBefore: n.departBefore,
      ...(typeof n.arriveBy === "number" ? { arriveBy: n.arriveBy } : {}),
      ...(typeof n.maxDetour === "number" ? { maxDetour: n.maxDetour } : {}),
      ...(groundMs ? { groundMs } : {}),
    });
  }
  return out;
}

/** The bid pack's FedEx flights, as the browser read them — well-formed and plausible, or none at all. */
function readJumpseats(value: unknown): ScheduledFlight[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_JUMPSEATS) return null;
  const out: ScheduledFlight[] = [];
  for (const f of value) {
    if (!isJsonObject(f) || typeof f.n !== "string" || !/^FX \d{1,5}$/.test(f.n) || !code(f.from) || !code(f.to)) return null;
    if (typeof f.dep !== "number" || typeof f.arr !== "number" || f.arr <= f.dep || f.arr - f.dep > 20 * 3600_000) return null;
    out.push({ n: f.n, from: f.from, to: f.to, dep: f.dep, arr: f.arr, jumpseat: true });
  }
  return out;
}

/**
 * A commuter's real flights: for each trip's travel (to base, deviating to join a trip, home again), how many real
 * airline itineraries (and FedEx jumpseats from the pilot's own bid pack) fit, the last one that still works, and the first one home. Without the flight-data key
 * configured, it says so and the app keeps its estimates.
 *
 * Only new boards are charged, to the caller's daily flight allowance; once that's gone the lookup answers from boards
 * already cached, for free, and what those can't answer stays an estimate.
 */
export async function POST(request: Request) {
  if (!flightDataConfigured()) return NextResponse.json({ configured: false, answers: [] });
  const { ok } = await checkRequestLimit("flights-travel", request, 20, 60 * 60);
  if (!ok) return rateLimitedResponse();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const needs = isJsonObject(body) ? readNeeds(body.needs) : null;
  const jumpseats = isJsonObject(body) ? readJumpseats(body.jumpseats) : null;
  if (!needs || !jumpseats) return NextResponse.json({ error: "Invalid travel request." }, { status: 400 });
  const spender = await spenderFor(request);
  const allowed = await checkSpend(spender, { feature: "flights" });
  const costPerBoard = boardCostUsd();
  const maxBoards = allowed.ok ? Math.floor((allowed.leftUsd ?? 0) / costPerBoard) : 0;
  try {
    const { answers, stats } = await answerTravelNeeds(needs, jumpseats, { maxBoards });
    await recordSpend(spender, stats.fetched * costPerBoard, { feature: "flights" });
    console.log("[flights]", { needs: needs.length, jumpseats: jumpseats.length, answered: answers.length, ...stats });
    // Boards held back (the allowance ran out) can only have hidden flights: a "no" in these answers isn't certain.
    return NextResponse.json({ configured: true, answers, ...(stats.skipped > 0 ? { partial: true } : {}) });
  } catch (e) {
    await reportProblem("flights", e);
    return NextResponse.json({ error: "Couldn't look up flights just now." }, { status: 502 });
  }
}
