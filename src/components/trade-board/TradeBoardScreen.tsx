"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NoteBox } from "@/components/ui/NoteBox";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmEmailButton, ConfirmEmailRefusal } from "@/components/auth/ConfirmEmail";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Notice } from "@/components/ui/Notice";
import { NotamStrip } from "@/components/ui/NotamStrip";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { PaperPlane } from "@/components/ui/PaperPlane";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SkeletonCards } from "@/components/ui/SkeletonCards";
import { TextField } from "@/components/ui/TextField";
import { HoldingPanel } from "@/components/trade-board/HoldingPanel";
import { TradeSuggestions } from "@/components/trade-board/TradeSuggestions";
import { useAppState } from "@/lib/app-state";
import { isSamplePack, withExampleOffer } from "@/lib/fake-trade-offers";
import { sameBidPack } from "@/lib/inbox";
import {
  acceptOffer,
  declineOffer,
  fetchTradeBoardOpen,
  fetchTradeOffers,
  formatTripDate,
  postTradeOffer,
  respondToOffer,
  tripDate,
  tripToSnapshot,
  withdrawOffer,
} from "@/lib/trade-client";
import { tripInstanceKey } from "@/lib/trades/legality";
import { alreadyTraded } from "@/lib/trades/offer-trips";
import type { BidPack, Trip } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { TradeHolding, TripSnapshot, TradeOffer } from "@/types/trade";

function formatHours(hours: number): string {
  // Whole minutes first, so 20.999 h reads 21:00 rather than 20:60.
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/** A trip the pilot could offer or propose, paired with the line it's on. */
interface LineTripEntry {
  /** Unique per (line, trip) — `trip.id` alone isn't enough, since the same real pairing can recur across several of a pilot's lines and would collide as a React key / form value. */
  entryKey: string;
  lineNumber: string;
  trip: Trip;
}

function allTrips(bidPack: BidPack): LineTripEntry[] {
  return bidPack.lines.flatMap((line) =>
    line.trips.map((trip) => ({ entryKey: `${line.lineNumber}-${trip.id}`, lineNumber: line.lineNumber, trip }))
  );
}

/**
 * The trips this pilot holds, to offer or propose: what they confirmed holding, else the line their Logbook says they
 * were awarded. Listing every trip in the pack let a pilot offer one they don't have. Trips they marked as ones they
 * can't trade are left out, and so are those already in a trade they agreed this month: the server refuses those.
 * The sample pack is the demo, where nothing is held, so any of its trips will do there.
 */
function pilotTrips(bidPack: BidPack, holding: TradeHolding | null, awardedLine: string | null, offers: readonly TradeOffer[], userId: string | null): LineTripEntry[] {
  const held = heldTrips(bidPack, holding, awardedLine);
  if (!userId) return held;
  return held.filter((e) => !alreadyTraded(offers, bidPack, userId, tripToSnapshot(e.trip, e.lineNumber)));
}

function heldTrips(bidPack: BidPack, holding: TradeHolding | null, awardedLine: string | null): LineTripEntry[] {
  if (holding) {
    const byKey = new Map(bidPack.lines.flatMap((l) => l.trips.map((t) => [tripInstanceKey(t), { lineNumber: l.lineNumber, trip: t }] as const)));
    return holding.trips.flatMap((h) => {
      const found = h.lock ? undefined : byKey.get(tripInstanceKey(h));
      return found ? [{ entryKey: tripInstanceKey(h), lineNumber: holding.lineNumber ?? found.lineNumber, trip: found.trip }] : [];
    });
  }
  const line = awardedLine ? bidPack.lines.find((l) => l.lineNumber === awardedLine) : undefined;
  if (line) return line.trips.map((trip) => ({ entryKey: tripInstanceKey(trip), lineNumber: line.lineNumber, trip }));
  return isSamplePack(bidPack) ? allTrips(bidPack) : [];
}

/** How a pilot identifies a trip: by its own pairing number when known, since that's the recognizable, recurring identifier — falling back to "Line X's trip" for an estimated trip with no confirmed pairing. The date says which day of the pairing. */
function tripLabel(entry: LineTripEntry, bidPeriodStart: string | null): string {
  const base = entry.trip.pairingNumber
    ? `Pairing ${entry.trip.pairingNumber}`
    : `Line ${entry.lineNumber}'s trip`;
  const date = formatTripDate(tripDate(bidPeriodStart, entry.trip.startDayIndex));
  const cities = entry.trip.layoverCities.length > 0 ? entry.trip.layoverCities.join(" → ") : "no layovers";
  return `${base}${date ? `, ${date}` : ""} — ${entry.trip.days}-day${entry.trip.international ? " intl" : ""}, ${cities} (Line ${entry.lineNumber})`;
}

/** How long after a board check that got no answer it's asked again on its own. */
const BAR_RETRY_MS = 30_000;

/** Above this many open offers, an unfiltered scroll stops being the fastest way to find a specific pairing or city — worth showing a search box. Below it, the box would just be clutter over a handful of cards. */
const SEARCH_THRESHOLD = 4;

function matchesSearch(offer: TradeOffer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    offer.offeringDisplayName,
    offer.offeredTrip.pairingNumber,
    offer.wantedPairingNumber,
    ...offer.offeredTrip.layoverCities,
  ]
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

interface TradeBoardScreenProps {
  bidPack: BidPack | null;
  user: UserAccount | null;
  /** A synthetic, client-only offer for demo purposes — see `fake-trade-offers.ts`. */
  demoOffer?: TradeOffer | null;
  onAcceptDemoOffer?: () => void;
  /** The board as the app last polled it — see \`useAppState().tradeOffers\`. */
  polledOffers?: TradeOffer[];
}

export function TradeBoardScreen({
  bidPack,
  user,
  demoOffer,
  onAcceptDemoOffer,
  polledOffers,
}: TradeBoardScreenProps) {
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNeedsConfirm, setActionNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sends, setSends] = useState(0);
  const [search, setSearch] = useState("");
  const { profile, refreshTradeActivity } = useAppState();
  /** Bumped when the holding panel saves, so the trades found below are asked for again straight away. */
  const [suggestionsKey, setSuggestionsKey] = useState(0);
  /** What the pilot confirmed holding, as the panel above loaded or saved it, for the pack it was loaded for. */
  const [held, setHeld] = useState<{ packId: string; holding: TradeHolding | null } | null>(null);
  const holding = bidPack && held?.packId === bidPack.id ? held.holding : null;
  const awardedLine = bidPack ? ((profile?.logbook ?? []).find((m) => m.bidPackId === bidPack.id && m.lineNumber)?.lineNumber ?? null) : null;
  const myTrips = bidPack ? pilotTrips(bidPack, holding, awardedLine, offers, user?.id ?? null) : [];

  // One seat's board for one month: the server sends nothing else.
  const boardKey = bidPack ? [bidPack.base, bidPack.aircraft, bidPack.seat, bidPack.month].join("|") : null;
  const refresh = useCallback(async () => {
    if (!boardKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [base, aircraft, seat, month] = boardKey.split("|");
    const data = await fetchTradeOffers({ base, aircraft, seat, month });
    setLoadFailed(data === null);
    if (data) setOffers(data);
    setLoading(false);
  }, [boardKey]);

  const signedIn = !!user;
  useEffect(() => {
    // The board is for signed-in pilots only: a guest's request would just be refused.
    if (!signedIn) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    // One-time fetch of the board on mount — a legitimate external-data
    // load, not state derived from props/state that belongs in render.
    refresh();
  }, [refresh, signedIn]);

  // The app polls the board every few seconds (the Inbox badge and toasts read it): each new poll is shown here too,
  // or a proposal could clear the badge while this list still holds the copy from when the screen opened.
  const firstPoll = useRef(polledOffers);
  useEffect(() => {
    if (polledOffers && polledOffers !== firstPoll.current) {
      setOffers(polledOffers);
      setLoadFailed(false);
    }
  }, [polledOffers]);

  // A real pack's board stays hidden until its seat has enough pilots (`lib/server/trade-board-bar.ts`). The sample pack
  // is the demo, and with no pack there's no seat to ask about.
  const barSeat = signedIn && bidPack && !isSamplePack(bidPack) ? `${bidPack.base}|${bidPack.aircraft}|${bidPack.seat}` : null;
  const [barAnswer, setBarAnswer] = useState<{ seat: string; open: boolean | null } | null>(null);
  /** Bumped to ask again: the pilot's Try again, or the timer below after a check that got no answer. */
  const [barTry, setBarTry] = useState(0);
  useEffect(() => {
    if (!barSeat) return;
    let cancelled = false;
    const [base, aircraft, seat] = barSeat.split("|");
    fetchTradeBoardOpen({ base, aircraft, seat }).then((open) => {
      if (!cancelled) setBarAnswer({ seat: barSeat, open });
    });
    return () => {
      cancelled = true;
    };
  }, [barSeat, barTry]);
  // No answer: asked again on its own after a while, as the app's other checks are, not left on the error for good.
  const barUnanswered = !!barSeat && barAnswer?.seat === barSeat && barAnswer.open === null;
  useEffect(() => {
    if (!barUnanswered) return;
    const timer = setTimeout(() => setBarTry((n) => n + 1), BAR_RETRY_MS);
    return () => clearTimeout(timer);
  }, [barUnanswered, barTry]);

  const realVisibleOffers = bidPack ? offers.filter((o) => sameBidPack(o, bidPack)) : offers;
  const visibleOffers = withExampleOffer(demoOffer, realVisibleOffers, bidPack, user?.id);
  const needsResponse = visibleOffers.filter(
    (o) => o.status === "pending" && o.offeringUserId === user?.id
  );
  const myActivity = visibleOffers.filter(
    (o) =>
      (o.offeringUserId === user?.id || o.responderUserId === user?.id) &&
      !needsResponse.includes(o)
  );
  const openFromOthers = visibleOffers.filter(
    (o) => o.status === "open" && o.offeringUserId !== user?.id
  );
  const shownOpenOffers =
    openFromOthers.length > SEARCH_THRESHOLD ? openFromOthers.filter((o) => matchesSearch(o, search)) : openFromOthers;

  async function runAction(action: () => Promise<{ ok: boolean; error?: string; confirmEmail?: boolean }>, onDone?: () => void) {
    setBusy(true);
    setActionError(null);
    setActionNeedsConfirm(false);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "Something went wrong. Try again.");
      setActionNeedsConfirm(!!result.confirmEmail);
      // Refresh anyway — a failure here usually means the offer's real state moved
      // (someone else claimed it, it was withdrawn), so the stale copy on screen
      // needs replacing rather than sitting there inviting the same retry.
      await refresh();
      return;
    }
    setShowPostForm(false);
    setRespondingTo(null);
    onDone?.();
    // The Inbox badge counts proposals waiting on this pilot: asked for now, not at the app's next poll.
    refreshTradeActivity();
    await refresh();
  }

  // Offers a pilot already has in play stay in front of them whatever the bar says.
  const barKnown = !!barSeat && barAnswer?.seat === barSeat;
  const barClosed = barKnown && barAnswer.open !== true && !loading && needsResponse.length === 0 && myActivity.length === 0;
  if (barSeat && (!barKnown || barClosed)) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader eyebrow={packEyebrow(bidPack)} title="Trade Board" />
        {!barKnown ? (
          <SkeletonCards shape="offer" className="mt-8" />
        ) : barAnswer.open === null ? (
          <EmptyState
            className="mt-8"
            title="Couldn’t load the board"
            description="Check your connection. It tries again on its own in a moment."
            actionLabel="Try again"
            onAction={() => {
              setBarAnswer(null);
              setBarTry((n) => n + 1);
            }}
          />
        ) : (
          <EmptyState className="mt-8" title="Coming when your seat has enough pilots" description="The board opens for a domicile, aircraft and seat once enough pilots are using Line Select there, so you'd find real offers on it. Nothing to do until then." />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Trade Board"
        description={
          <>
            Find other pilots interested in trading a trip &mdash; coordinate directly, since a real trip trade only
            happens after bidding closes and nothing here finalizes one.
          </>
        }
        actions={
          user && bidPack && !showPostForm ? <Button onClick={() => setShowPostForm(true)}>Post a trade offer</Button> : undefined
        }
      />

      {/* A posted offer folds into a paper plane and flies off to the board. */}
      <div className="relative h-0">{sends > 0 && <PaperPlane key={sends} className="right-24 top-0" />}</div>

      <NonBindingDisclaimer />

      {!user && (
        <InfoBanner>
          Sign in to see what other pilots have posted, and to post an offer or propose a trade.
        </InfoBanner>
      )}
      {user?.emailVerified === false && (
        <InfoBanner>
          <p>Confirm your email to post offers, answer them and see other pilots&rsquo; offers. It&rsquo;s how the board knows each account is a real pilot.</p>
          <ConfirmEmailButton className="mt-1.5" />
        </InfoBanner>
      )}
      {user && !bidPack && <InfoBanner>Upload your bid pack to post an offer or propose a trade.</InfoBanner>}
      {user && bidPack && !isSamplePack(bidPack) && <HoldingPanel bidPack={bidPack} onHolding={(h) => setHeld({ packId: bidPack.id, holding: h })} onSaved={() => setSuggestionsKey((n) => n + 1)} />}
      {user && bidPack && !isSamplePack(bidPack) && <TradeSuggestions packId={bidPack.id} refreshKey={suggestionsKey} />}

      {showPostForm && bidPack && (
        <PostOfferForm
          bidPack={bidPack}
          trips={myTrips}
          busy={busy}
          onCancel={() => setShowPostForm(false)}
          onSubmit={(input) => runAction(() => postTradeOffer(input), () => setSends((n) => n + 1))}
        />
      )}

      {actionError && (actionNeedsConfirm ? <ConfirmEmailRefusal className="mt-4" message={actionError} /> : <ErrorBanner className="mt-4">{actionError}</ErrorBanner>)}
      {loadFailed && <ErrorBanner className="mt-4">Couldn&rsquo;t load the board just now. Check your connection and try again in a moment.</ErrorBanner>}

      {loading ? (
        <SkeletonCards shape="offer" className="mt-8" />
      ) : (
        <div className="mt-8 space-y-8">
          {needsResponse.length > 0 && (
            <Section title="Needs your response" count={needsResponse.length}>
              {needsResponse.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  currentUserId={user?.id}
                  busy={busy}
                  onAccept={() => runAction(() => acceptOffer(offer.id, offer.respondedAt))}
                  onDecline={() => runAction(() => declineOffer(offer.id))}
                />
              ))}
            </Section>
          )}

          {myActivity.length > 0 && (
            <Section title="Your activity" count={myActivity.length}>
              {myActivity.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  currentUserId={user?.id}
                  busy={busy}
                  onWithdraw={
                    offer.offeringUserId === user?.id &&
                    (offer.status === "open" || offer.status === "pending")
                      ? () => runAction(() => withdrawOffer(offer.id))
                      : undefined
                  }
                />
              ))}
            </Section>
          )}

          <Section title="Open offers from other pilots" count={openFromOthers.length}>
            {openFromOthers.length > SEARCH_THRESHOLD && (
              <TextField
                label="Search by pilot, pairing, or city"
                placeholder="e.g. NRT, 27, or a pilot's name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            {openFromOthers.length === 0 ? (
              <EmptyState
                compact
                description={
                  user && bidPack
                    ? "No open offers for this bid pack yet. The board fills as pilots join, and offers here are non-binding."
                    : `No open offers to show${bidPack ? " for this bid pack" : ""}.`
                }
              />
            ) : shownOpenOffers.length === 0 ? (
              <EmptyState compact description="No open offers match that search." />
            ) : (
              shownOpenOffers.map((offer) =>
                offer.isDemo ? (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    currentUserId={user?.id}
                    busy={busy}
                    onAccept={user && bidPack ? onAcceptDemoOffer : undefined}
                  />
                ) : respondingTo === offer.id && bidPack ? (
                  <RespondForm
                    key={offer.id}
                    offer={offer}
                    bidPack={bidPack}
                    trips={myTrips}
                    busy={busy}
                    onCancel={() => setRespondingTo(null)}
                    onSubmit={(entry) =>
                      runAction(() =>
                        respondToOffer(offer.id, tripToSnapshot(entry.trip, entry.lineNumber, bidPack.bidPeriodStart))
                      )
                    }
                  />
                ) : (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    currentUserId={user?.id}
                    busy={busy}
                    onRespond={user && bidPack ? () => setRespondingTo(offer.id) : undefined}
                  />
                )
              )
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

export function NonBindingDisclaimer() {
  return (
    <NotamStrip className="mt-6" headline={<>This board is not official &mdash; a trade agreed here isn&rsquo;t a real schedule trade.</>}>
      Real trip trades have to go through FedEx&rsquo;s official scheduling process, after bidding closes &mdash; rest
      rules, qualifications, and currency all get checked there, and this app has no way to verify any of that. Use this
      board to find and coordinate with another pilot only.
    </NotamStrip>
  );
}

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="info" className="mt-3">
      {children}
    </Notice>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <SectionHeading count={count}>{title}</SectionHeading>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function TripSnapshotStats({ trip }: { trip: TripSnapshot }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
      <span>{trip.days}-day</span>
      {trip.international && <span className="text-accent">intl</span>}
      <span>{trip.layoverCities.length > 0 ? trip.layoverCities.join(" → ") : "no layovers"}</span>
      <span>{formatHours(trip.creditHours)} credit</span>
      <span>{formatHours(trip.tafbHours)} TAFB</span>
      <span>{trip.landings} ldgs</span>
      <span>
        {trip.deadheadLegs > 0 ? `${trip.deadheadLegs} DH leg${trip.deadheadLegs > 1 ? "s" : ""}` : "no deadhead"}
      </span>
    </div>
  );
}

export const STATUS_STYLES: Record<TradeOffer["status"], string> = {
  open: "bg-brand-soft text-brand",
  pending: "bg-accent-soft text-accent",
  accepted: "bg-good-soft text-good",
  declined: "bg-danger-soft text-danger",
  withdrawn: "bg-canvas text-ink-faint",
};

/** A small status-LED dot inside each pill — the same "this one's live" language the nav's active indicator already uses, not a new motif invented just for this screen. */
export const STATUS_DOT: Record<TradeOffer["status"], string> = {
  open: "bg-brand",
  pending: "bg-accent",
  accepted: "bg-good",
  declined: "bg-danger",
  withdrawn: "bg-ink-faint",
};

export const STATUS_LABELS: Record<TradeOffer["status"], string> = {
  open: "Open",
  pending: "Pending response",
  accepted: "Agreed",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/** "Pairing 13, Nov 5" when known, else a plain fallback naming which line it's from. The date says which day of the pairing (offers posted before it was kept have none). */
function offerTripName(trip: TripSnapshot): string {
  const date = formatTripDate(trip.date);
  return `${trip.pairingNumber ? `Pairing ${trip.pairingNumber}` : `a trip from Line ${trip.lineNumber}`}${date ? `, ${date}` : ""}`;
}

export function OfferCard({
  offer,
  currentUserId,
  busy,
  onRespond,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  offer: TradeOffer;
  currentUserId: string | undefined;
  busy: boolean;
  onRespond?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onWithdraw?: () => void;
}) {
  const isMine = offer.offeringUserId === currentUserId;
  const isMyResponse = offer.responderUserId === currentUserId;

  return (
    <div className="panel-glass hover-lift p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-base font-semibold text-ink">
            {isMine ? "You" : offer.isDemo ? "Example pilot" : offer.offeringDisplayName} offering {offerTripName(offer.offeredTrip)}
            {offer.isDemo && (
              <span
                title="An example of what an offer looks like, shown only with the sample bid pack. No real pilot posted it."
                className="ml-2 inline-block rounded-full bg-warn-soft px-2 py-0.5 align-middle font-sans text-[11px] font-semibold uppercase tracking-wide text-warn"
              >
                Example &mdash; not real
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <TripSnapshotStats trip={offer.offeredTrip} />
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[offer.status]}`}
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[offer.status]}`} />
          {STATUS_LABELS[offer.status]}
        </span>
      </div>

      <div className="mt-3 text-sm text-ink-muted">
        Wants:{" "}
        {offer.wantedPairingNumber ? (
          <span className="font-medium text-ink">Pairing {offer.wantedPairingNumber} specifically</span>
        ) : (
          <span className="font-medium text-ink">open to any trip</span>
        )}
      </div>

      {offer.note && (
        <p className="mt-2 text-sm italic text-ink-muted">&ldquo;{offer.note}&rdquo;</p>
      )}

      {offer.responderTrip && (
        <div className="mt-3 rounded-lg border border-hairline bg-canvas/50 p-3">
          <div className="text-sm font-medium text-ink">
            {isMyResponse ? "You" : offer.responderDisplayName} proposed{" "}
            {offerTripName(offer.responderTrip)}
          </div>
          <div className="mt-1">
            <TripSnapshotStats trip={offer.responderTrip} />
          </div>
        </div>
      )}

      {offer.status === "accepted" && (
        <div className="mt-3 rounded-lg border border-good/30 bg-good-soft px-3.5 py-2.5 text-sm text-good">
          Agreed &mdash; now file this through the official trade process, once bidding closes, to
          make it real.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {onRespond && (
          <Button variant="secondary" onClick={onRespond} disabled={busy}>
            Propose a trade
          </Button>
        )}
        {onAccept && (
          <Button onClick={onAccept} disabled={busy}>
            Accept
          </Button>
        )}
        {onDecline && (
          <Button variant="secondary" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
        )}
        {onWithdraw && (
          <Button variant="ghost" onClick={onWithdraw} disabled={busy}>
            Withdraw
          </Button>
        )}
        {isMyResponse && offer.status === "pending" && (
          <span className="self-center text-xs text-ink-faint">
            Awaiting {offer.offeringDisplayName}&rsquo;s decision
          </span>
        )}
      </div>
    </div>
  );
}

/** Said when the pilot has no trips to offer: the board only lists trips they hold. */
function NoTripsYet() {
  return (
    <p className="text-sm text-ink-muted">
      Confirm what you hold above, or log your award in your Logbook, and your trips are listed here to choose from.
    </p>
  );
}

function PostOfferForm({
  bidPack,
  trips,
  busy,
  onCancel,
  onSubmit,
}: {
  bidPack: BidPack;
  /** The pilot's own trips (`pilotTrips`). */
  trips: LineTripEntry[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    bidPackMeta: { base: string; aircraft: string; seat: string; month: string };
    offeredTrip: TripSnapshot;
    wantedPairingNumber: string | null;
    note: string | null;
  }) => void;
}) {
  const [pickedKey, setEntryKey] = useState(trips[0]?.entryKey ?? "");
  // The list can change while the form is open (what the pilot holds loads, or they update it): the first trip then.
  const entryKey = trips.some((t) => t.entryKey === pickedKey) ? pickedKey : (trips[0]?.entryKey ?? "");
  const [wantedPairingNumber, setWantedPairingNumber] = useState("");
  const [note, setNote] = useState("");

  // The form opens below the holding panel and any trades found, well down the page, and the button that opened it is
  // gone: brought into view, with focus on its first field, or it opened out of sight with focus nowhere.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    form.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    form.querySelector<HTMLElement>("select, input, textarea")?.focus({ preventScroll: true });
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const entry = trips.find((t) => t.entryKey === entryKey);
    if (!entry) return;
    onSubmit({
      bidPackMeta: {
        base: bidPack.base,
        aircraft: bidPack.aircraft,
        seat: bidPack.seat,
        month: bidPack.month,
      },
      offeredTrip: tripToSnapshot(entry.trip, entry.lineNumber, bidPack.bidPeriodStart),
      wantedPairingNumber: wantedPairingNumber.trim() || null,
      note: note.trim() || null,
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      aria-label="Post a trade offer"
      className="panel-glass glow-soft mt-6 scroll-mt-20 space-y-4 p-5 md:scroll-mt-6"
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="offer-trip">
          Which trip are you offering?
        </label>
        {trips.length === 0 ? (
          <NoTripsYet />
        ) : (
          <select
            id="offer-trip"
            value={entryKey}
            onChange={(e) => setEntryKey(e.target.value)}
            className="w-full rounded-md border border-field-edge bg-surface px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          >
            {trips.map((entry) => (
              <option key={entry.entryKey} value={entry.entryKey}>
                {tripLabel(entry, bidPack.bidPeriodStart)}
              </option>
            ))}
          </select>
        )}
      </div>

      <TextField
        label="Want a specific pairing back? (optional)"
        placeholder="e.g. 27 — leave blank if open to any trip"
        value={wantedPairingNumber}
        onChange={(e) => setWantedPairingNumber(e.target.value)}
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="offer-note">
          Note (optional)
        </label>
        <NoteBox id="offer-note" value={note} onChange={setNote} placeholder="Anything else worth mentioning" />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !entryKey}>
          Post offer
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RespondForm({
  offer,
  bidPack,
  trips,
  busy,
  onCancel,
  onSubmit,
}: {
  offer: TradeOffer;
  bidPack: BidPack;
  /** The pilot's own trips (`pilotTrips`). */
  trips: LineTripEntry[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (entry: LineTripEntry) => void;
}) {
  const eligibleTrips = offer.wantedPairingNumber
    ? trips.filter((t) => t.trip.pairingNumber === offer.wantedPairingNumber)
    : trips;
  const [pickedKey, setEntryKey] = useState(eligibleTrips[0]?.entryKey ?? "");
  const entryKey = eligibleTrips.some((t) => t.entryKey === pickedKey) ? pickedKey : (eligibleTrips[0]?.entryKey ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const entry = eligibleTrips.find((t) => t.entryKey === entryKey);
    if (entry) onSubmit(entry);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="panel-glass glow-soft p-5"
    >
      <div className="text-sm font-semibold text-ink">
        Propose a trade with {offer.offeringDisplayName}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Offering their {offerTripName(offer.offeredTrip)} in exchange for one of your trips.
      </p>

      {trips.length === 0 ? (
        <div className="mt-3">
          <NoTripsYet />
        </div>
      ) : eligibleTrips.length === 0 ? (
        <p className="mt-3 text-sm text-danger">
          You don&rsquo;t hold Pairing {offer.wantedPairingNumber}, so you can&rsquo;t propose this trade.
        </p>
      ) : (
        <div className="mt-3">
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor={`respond-trip-${offer.id}`}>
            Which of your trips?
          </label>
          <select
            id={`respond-trip-${offer.id}`}
            value={entryKey}
            onChange={(e) => setEntryKey(e.target.value)}
            className="w-full rounded-md border border-field-edge bg-surface px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          >
            {eligibleTrips.map((entry) => (
              <option key={entry.entryKey} value={entry.entryKey}>
                {tripLabel(entry, bidPack.bidPeriodStart)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={busy || eligibleTrips.length === 0}>
          Send proposal
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
