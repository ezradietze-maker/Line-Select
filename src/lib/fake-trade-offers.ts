/**
 * Client-only demo data for the Trade Board: synthetic offers built from the
 * sample bid pack's trips, so a first-time visitor can see how the board works.
 * Only ever for the sample pack: with a pilot's real pack the board shows real
 * offers or none, so an invented pilot can never be mistaken for a colleague.
 * Never sent to the server, never visible to other real pilots, and always
 * tagged `isDemo: true` so the UI can badge it clearly.
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

/** Whether this is the sample pack rather than one a pilot uploaded. */
export function isSamplePack(bidPack: Pick<BidPack, "id">): boolean {
  return bidPack.id.startsWith("sample");
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/** Every trip in the bid pack, paired with which of the pilot's lines it lives on. */
function allTrips(bidPack: BidPack): { lineNumber: string; trip: Trip }[] {
  return bidPack.lines.flatMap((line) => line.trips.map((trip) => ({ lineNumber: line.lineNumber, trip })));
}

/**
 * Builds one synthetic open offer from the sample pack, or null for any other pack.
 * `biasWantedPairingNumber`, when supplied, is used for the "wants back" field most of the
 * time, so the example lines up with an open offer of the pilot's own rather than only
 * occasionally by chance.
 */
export function generateFakeOffer(
  bidPack: BidPack,
  biasWantedPairingNumber?: string | null
): TradeOffer | null {
  if (!isSamplePack(bidPack)) return null;
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

/**
 * The board's offers with the example added: only for the sample pack, and only while no real pilot has an open offer
 * on it, so an invented one never sits next to (or gets mistaken for) a real one. Checked here as well as where offers
 * are made because a pack just loaded over the sample still has the old example for a moment.
 */
export function withExampleOffer(
  demoOffer: TradeOffer | null | undefined,
  realOffers: TradeOffer[],
  bidPack: BidPack | null,
  userId: string | undefined
): TradeOffer[] {
  if (!demoOffer || !bidPack || !isSamplePack(bidPack)) return realOffers;
  const hasRealOpenOffer = realOffers.some((o) => o.status === "open" && o.offeringUserId !== userId);
  return hasRealOpenOffer ? realOffers : [demoOffer, ...realOffers];
}
