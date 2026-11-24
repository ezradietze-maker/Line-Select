"use client";

import { useRouter } from "next/navigation";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { TripRankingsView } from "@/components/trips/TripRankingsView";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";

export default function TripsPage() {
  const router = useRouter();
  const { bidPack, profile, user, handleStartInterview, handleTrySample, handleUpdateProfileWith } = useAppState();

  if (profile && bidPack) {
    // No membership: the trips their top lines fly, as My Rankings shows them their top lines only. Keyed on it too, so
    // a membership taken out (or one that lapses) during the visit opens the page afresh.
    const member = hasAccess(user);
    return (
      <TripRankingsView
        key={`${user?.id ?? "guest"}|${bidPack.id}|${member}`}
        bidPack={bidPack}
        profile={profile}
        onEditPreferences={() => router.push("/preferences")}
        rankedLinesOnly={!member}
        onUpdateProfileWith={handleUpdateProfileWith}
      />
    );
  }

  // No profile yet (or no bid pack at all): the same place My Rankings sends a pilot.
  return <PreferencesScreen bidPack={bidPack} profile={profile} onGoToUpload={() => router.push("/upload")} onTrySample={handleTrySample} onStartInterview={handleStartInterview} />;
}
