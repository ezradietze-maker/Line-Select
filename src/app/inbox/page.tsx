"use client";

import { useRouter } from "next/navigation";
import { InboxScreen } from "@/components/trade-board/InboxScreen";
import { useAppState } from "@/lib/app-state";

export default function InboxPage() {
  const router = useRouter();
  const { bidPack, user, demoOffer } = useAppState();
  return (
    <InboxScreen
      bidPack={bidPack}
      user={user}
      demoOffer={demoOffer}
      onGoToTradeBoard={() => router.push("/trade-board")}
    />
  );
}
