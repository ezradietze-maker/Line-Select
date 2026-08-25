/**
 * Client-only demo data for the Trade Board and Inbox: synthetic offers built
 * from a pilot's own real bid pack trips, so the numbers look legitimate.
 * Never sent to the server, never visible to other real pilots, and always
 * tagged `isDemo: true` so the UI can badge it clearly. This exists purely so
 * the trade flow has something to interact with before real pilots are using
 * the board — it should come out once there's real activity to show instead.
 */
import { tripToSnapshot } from "@/lib/trade-client";
import type { BidPack, Trip } from "@/types/bidpack";
import type { TradeOffer } from "@/types/trade";

const FAKE_PILOT_NAMES = [
  "J. Alvarez",
  "M. Chen",
  "R. Okafor",
  "S. Novak",
  "T. Delgado",
  "K. Whitfield",
  "D. Park",
  "A. Fontaine",
  "L. Mercer",
  "B. Osei",
  "C. Iverson",
  "N. Haddad",
];

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/** Every trip in the bid pack, paired with which of the pilot's lines it lives on. */
function allTrips(bidPack: BidPack): { lineNumber: string; trip: Trip }[] {
  return bidPack.lines.flatMap((line) => line.trips.map((trip) => ({ lineNumber: line.lineNumber, trip })));
}

/**
 * Builds one synthetic open offer from the pilot's own bid pack. `biasWantedPairingNumber`,
 * when supplied, is used for the "wants back" field most of the time — this is how the
 * Inbox's "direct interest in your trips" section (and its notifications) reliably get
 * demo data to show once the pilot has an open offer of their own, rather than only
 * occasionally lining up by chance.
 */
export function generateFakeOffer(
  bidPack: BidPack,
  biasWantedPairingNumber?: string | null
): TradeOffer | null {
  const trips = allTrips(bidPack);
  if (trips.length === 0) return null;

  const offered = pickRandom(trips);
  if (!offered) return null;

  const otherTrips = trips.filter((t) => t.trip.id !== offered.trip.id);
  let wantedPairingNumber: string | null = null;
  if (biasWantedPairingNumber && Math.random() < 0.85) {
    wantedPairingNumber = biasWantedPairingNumber;
  } else if (Math.random() < 0.4) {
    wantedPairingNumber = pickRandom(otherTrips)?.trip.pairingNumber ?? null;
  }

  const name = pickRandom(FAKE_PILOT_NAMES) ?? "A. Pilot";
  const now = new Date().toISOString();

  return {
    id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bidPackMeta: {
      base: bidPack.base,
      aircraft: bidPack.aircraft,
      seat: bidPack.seat,
      month: bidPack.month,
    },
    offeringUserId: "demo-pilot",
    offeringDisplayName: name,
    offeredTrip: tripToSnapshot(offered.trip, offered.lineNumber),
    wantedPairingNumber,
    note: null,
    status: "open",
    createdAt: now,
    responderUserId: null,
    responderDisplayName: null,
    responderTrip: null,
    respondedAt: null,
    resolvedAt: null,
    isDemo: true,
  };
}
