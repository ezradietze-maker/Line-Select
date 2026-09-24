"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { ResultsView } from "@/components/results/ResultsView";
import { useAppState } from "@/lib/app-state";
import { parseHotelFilter } from "@/lib/hotel-filter";

export default function ResultsPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <ResultsPageContent />
    </Suspense>
  );
}

function ResultsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
        initialHotelFilter={parseHotelFilter(searchParams)}
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
