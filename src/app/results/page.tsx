"use client";

import { useRouter } from "next/navigation";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { ResultsView } from "@/components/results/ResultsView";
import { useAppState } from "@/lib/app-state";

export default function ResultsPage() {
  const router = useRouter();
  const { bidPack, profile, user, handleStartOver, handleStartInterview, handleUpdateProfile } = useAppState();

  if (profile && bidPack) {
    return (
      <ResultsView
        bidPack={bidPack}
        profile={profile}
        onStartOver={handleStartOver}
        onRefine={handleStartInterview}
        onUpdateProfile={handleUpdateProfile}
        userId={user?.id ?? null}
      />
    );
  }

  // No profile yet (or no bid pack at all) — same fallback content the old
  // single-page app showed at this same "screen", not a redirect.
  return (
    <PreferencesScreen
      hasBidPack={!!bidPack}
      profile={profile}
      onGoToUpload={() => router.push("/upload")}
      onStartInterview={handleStartInterview}
    />
  );
}
