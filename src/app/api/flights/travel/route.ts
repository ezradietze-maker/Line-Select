import { NextResponse } from "next/server";
import type { ScheduledFlight } from "@/lib/flights/itineraries";
import type { TravelNeed } from "@/lib/flights/needs";
import { answerTravelNeeds, flightDataConfigured } from "@/lib/server/flight-schedules";
import { isJsonObject } from "@/lib/server/json-body";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
// The first look at a month's flights fetches a few hundred departure boards; after that it's cached.
export const maxDuration = 300;

const MAX_NEEDS = 600;
const MAX_JUMPSEATS = 4000;
const KINDS = new Set(["toBase", "deviateOut", "homeFromBase", "deviateHome"]);
const code = (x: unknown): x is string => typeof x === "string" && /^[A-Z]{3}$/.test(x);

function readNeeds(value: unknown): TravelNeed[] | null {
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
    if (n.arriveBy !== undefined && typeof n.arriveBy !== "number") return null;
    out.push({
      id: n.id,
      tripId: n.tripId,
      kind: n.kind as TravelNeed["kind"],
      from: n.from as string[],
      to: n.to as string[],
      departAfter: n.departAfter,
      departBefore: n.departBefore,
      ...(typeof n.arriveBy === "number" ? { arriveBy: n.arriveBy } : {}),
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
 */
export async function POST(request: Request) {
  if (!flightDataConfigured()) return NextResponse.json({ configured: false, answers: [] });
  const { ok } = await checkRateLimit("flights-travel", clientIp(request), 20, 60 * 60);
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
  try {
    const { answers, stats } = await answerTravelNeeds(needs, jumpseats);
    console.log("[flights]", { needs: needs.length, jumpseats: jumpseats.length, answered: answers.length, ...stats });
    return NextResponse.json({ configured: true, answers });
  } catch (e) {
    console.error("[flights] failed", e);
    return NextResponse.json({ error: "Couldn't look up flights just now." }, { status: 502 });
  }
}
