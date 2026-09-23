"use client";

import { useRouter } from "next/navigation";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { useAppState } from "@/lib/app-state";

export default function PreferencesPage() {
  const router = useRouter();
  const {
    bidPack,
    profile,
    freshBidPack,
    handleStartInterview,
    handleAcknowledgeFreshBidPack,
    handleSaveProfileEdits,
  } = useAppState();
  return (
    <PreferencesScreen
      bidPack={bidPack}
      profile={profile}
      freshBidPack={freshBidPack}
      onGoToUpload={() => router.push("/upload")}
      onStartInterview={handleStartInterview}
      onShowRankings={() => {
        handleAcknowledgeFreshBidPack();
        router.push("/results");
      }}
      onSaveEdits={handleSaveProfileEdits}
    />
  );
}
