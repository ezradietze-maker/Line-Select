"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { ResultsView } from "@/components/results/ResultsView";
import { useAppState } from "@/lib/app-state";

export default function ResultsPage() {
  const router = useRouter();
  const { bidPack, profile, user, handleStartOver, handleStartInterview, handleUpdateProfile, handleAcknowledgeFreshBidPack } =
    useAppState();
  const showingResults = !!(profile && bidPack);

  useEffect(() => {
    // Looking at rankings is the answer to "same preferences as last month?" — clear the prompt so it doesn't linger on Preferences.
    if (showingResults) handleAcknowledgeFreshBidPack();
  }, [showingResults, handleAcknowledgeFreshBidPack]);

  if (profile && bidPack) {
    return (
      <ResultsView
        bidPack={bidPack}
        profile={profile}
        onStartOver={handleStartOver}
        onUploadNewPack={() => router.push("/upload")}
        onEditPreferences={() => router.push("/preferences")}
        onUpdateProfile={handleUpdateProfile}
        userId={user?.id ?? null}
      />
    );
  }

  // No profile yet (or no bid pack at all) — same fallback content the old
  // single-page app showed at this same "screen", not a redirect.
  return (
    <PreferencesScreen
      bidPack={bidPack}
      profile={profile}
      onGoToUpload={() => router.push("/upload")}
      onStartInterview={handleStartInterview}
    />
  );
}
