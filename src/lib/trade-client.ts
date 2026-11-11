import type { BidPackMetaSnapshot, TripSnapshot, TradeOffer } from "@/types/trade";
import type { Trip } from "@/types/bidpack";

/** The day a trip starts, YYYY-MM-DD; null when the pack doesn't place it on one. */
export function tripDate(bidPeriodStart: string | null, startDayIndex: number | null): string | null {
  if (!bidPeriodStart || startDayIndex === null) return null;
  const d = new Date(`${bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + startDayIndex);
  return d.toISOString().slice(0, 10);
}

/** "Nov 5" for a trip's YYYY-MM-DD day. */
export function formatTripDate(date: string | null | undefined): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** What the board keeps of a trip. `bidPeriodStart` dates it: without a date, "Pairing 13" could be any day it flies. */
export function tripToSnapshot(trip: Trip, lineNumber: string, bidPeriodStart: string | null = null): TripSnapshot {
  return {
    tripId: trip.id,
    startDayIndex: trip.startDayIndex,
    date: tripDate(bidPeriodStart, trip.startDayIndex),
    lineNumber,
    pairingNumber: trip.pairingNumber,
    days: trip.days,
    layoverCities: trip.layoverCities,
    international: trip.international,
    reportTime: trip.reportTime,
    creditHours: trip.creditHours,
    tafbHours: trip.tafbHours,
    landings: trip.landings,
    deadheadLegs: trip.deadheadLegs,
  };
}

interface ActionResult {
  ok: boolean;
  error?: string;
  offer?: TradeOffer;
}

async function postAction(url: string, body?: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error ?? "Something went wrong." };
    return { ok: true, offer: data.offer };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/**
 * One seat's board for one month: its open offers and the pilot's own. Empty for a guest (it's for signed-in pilots),
 * null when it couldn't be loaded, which isn't the same as no offers.
 */
export async function fetchTradeOffers(pack: BidPackMetaSnapshot): Promise<TradeOffer[] | null> {
  try {
    const query = new URLSearchParams({ base: pack.base, aircraft: pack.aircraft, seat: pack.seat, month: pack.month });
    const res = await fetch(`/api/trades?${query.toString()}`, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) return [];
    if (!res.ok) return null;
    const data = await res.json();
    return (data.offers as TradeOffer[]) ?? [];
  } catch {
    return null;
  }
}

export function postTradeOffer(input: {
  bidPackMeta: BidPackMetaSnapshot;
  offeredTrip: TripSnapshot;
  wantedPairingNumber: string | null;
  note: string | null;
}): Promise<ActionResult> {
  return postAction("/api/trades", input);
}

export function respondToOffer(id: string, responderTrip: TripSnapshot): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/respond`, { responderTrip });
}

/** `respondedAt` is the proposal the pilot saw: if a different one has taken its place since, nothing is accepted. */
export function acceptOffer(id: string, respondedAt: string | null): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/accept`, { respondedAt });
}

export function declineOffer(id: string): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/decline`);
}

export function withdrawOffer(id: string): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/withdraw`);
}

/** Whether this seat's board has opened. A failed check reads as not yet: it's only a matter of waiting. */
export async function fetchTradeBoardOpen(seat: { base: string; aircraft: string; seat: string }): Promise<boolean> {
  try {
    const res = await fetch(`/api/trade-board/status?${new URLSearchParams(seat).toString()}`);
    if (!res.ok) return false;
    return ((await res.json()) as { open?: boolean }).open === true;
  } catch {
    return false;
  }
}
