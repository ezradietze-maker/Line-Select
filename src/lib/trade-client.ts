import type { BidPackMetaSnapshot, TripSnapshot, TradeOffer } from "@/types/trade";
import type { Trip } from "@/types/bidpack";

export function tripToSnapshot(trip: Trip, lineNumber: string): TripSnapshot {
  return {
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

export async function fetchTradeOffers(): Promise<TradeOffer[]> {
  try {
    const res = await fetch("/api/trades", { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.offers as TradeOffer[]) ?? [];
  } catch {
    return [];
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

export function acceptOffer(id: string): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/accept`);
}

export function declineOffer(id: string): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/decline`);
}

export function withdrawOffer(id: string): Promise<ActionResult> {
  return postAction(`/api/trades/${id}/withdraw`);
}
