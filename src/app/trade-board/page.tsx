"use client";

import { TradeBoardScreen } from "@/components/trade-board/TradeBoardScreen";
import { useAppState } from "@/lib/app-state";

export default function TradeBoardPage() {
  const { bidPack, user, demoOffer, handleAcceptDemoOffer } = useAppState();
  return (
    <TradeBoardScreen bidPack={bidPack} user={user} demoOffer={demoOffer} onAcceptDemoOffer={handleAcceptDemoOffer} />
  );
}
