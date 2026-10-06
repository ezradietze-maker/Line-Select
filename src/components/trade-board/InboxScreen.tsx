"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SkeletonCards } from "@/components/ui/SkeletonCards";
import {
  InfoBanner,
  NonBindingDisclaimer,
  OfferCard,
  Section,
} from "@/components/trade-board/TradeBoardScreen";
import { computeInboxSections, sameBidPack } from "@/lib/inbox";
import { fetchTradeOffers } from "@/lib/trade-client";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { TradeOffer } from "@/types/trade";

interface InboxScreenProps {
  bidPack: BidPack | null;
  user: UserAccount | null;
  /** A synthetic, client-only offer for demo purposes — see `fake-trade-offers.ts`. */
  onGoToTradeBoard: () => void;
}

export function InboxScreen({ bidPack, user, onGoToTradeBoard }: InboxScreenProps) {
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchTradeOffers();
    setOffers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // One-time fetch of the board on mount — a legitimate external-data
    // load, not state derived from props/state that belongs in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const realVisibleOffers = bidPack ? offers.filter((o) => sameBidPack(o, bidPack)) : offers;
  const visibleOffers = realVisibleOffers;

  const { needsResponse, directInterest, accepted } = computeInboxSections(visibleOffers, user?.id);

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Inbox"
        description={
          <>
            Trades that need your response, pilots specifically after one of your posted trips, and any of your trades
            that reached an agreement.
          </>
        }
      />

      <NonBindingDisclaimer />

      {!user && (
        <InfoBanner>
          Sign in to see offers addressed to your posted trips and track your accepted trades.
        </InfoBanner>
      )}
      {user && !bidPack && <InfoBanner>Upload your bid pack to use the Inbox.</InfoBanner>}

      {loading ? (
        <SkeletonCards shape="offer" className="mt-8" />
      ) : (
        <div className="mt-8 space-y-8">
          <Section title="Needs your response" count={needsResponse.length}>
            {needsResponse.length === 0 ? (
              <EmptyState compact description="No proposals waiting on you right now." />
            ) : (
              needsResponse.map((offer) => (
                <div key={offer.id} className="space-y-3">
                  <OfferCard offer={offer} currentUserId={user?.id} busy={false} />
                  <Button variant="secondary" onClick={onGoToTradeBoard}>
                    Go respond on Trade Board
                  </Button>
                </div>
              ))
            )}
          </Section>

          <Section title="Direct interest in your trips" count={directInterest.length}>
            {directInterest.length === 0 ? (
              <EmptyState
                compact
                description="No one’s specifically asked for one of your posted trips yet."
              />
            ) : (
              directInterest.map((offer) => (
                <div key={offer.id} className="space-y-3">
                  <OfferCard offer={offer} currentUserId={user?.id} busy={false} />
                  <Button variant="secondary" onClick={onGoToTradeBoard}>
                    Go respond on Trade Board
                  </Button>
                </div>
              ))
            )}
          </Section>

          <Section title="Accepted trades" count={accepted.length}>
            {accepted.length === 0 ? (
              <EmptyState compact description="No agreed trades yet." />
            ) : (
              accepted.map((offer) => (
                <OfferCard key={offer.id} offer={offer} currentUserId={user?.id} busy={false} />
              ))
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
