"use client";

import { useRouter } from "next/navigation";
import { InboxScreen } from "@/components/trade-board/InboxScreen";
import { useAppState } from "@/lib/app-state";

export default function InboxPage() {
  const router = useRouter();
  const { bidPack, user } = useAppState();
  return (
    <InboxScreen
      bidPack={bidPack}
      user={user}
      onGoToTradeBoard={() => router.push("/trade-board")}
    />
  );
}
