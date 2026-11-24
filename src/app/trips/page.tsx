"use client";

import { useRouter } from "next/navigation";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { TripRankingsView } from "@/components/trips/TripRankingsView";
import { useAppState } from "@/lib/app-state";

export default function TripsPage() {
  const router = useRouter();
  const { bidPack, profile, user, handleStartInterview, handleTrySample } = useAppState();

  if (profile && bidPack) {
    return <TripRankingsView key={`${user?.id ?? "guest"}|${bidPack.id}`} bidPack={bidPack} profile={profile} onEditPreferences={() => router.push("/preferences")} />;
  }

  // No profile yet (or no bid pack at all): the same place My Rankings sends a pilot.
  return <PreferencesScreen bidPack={bidPack} profile={profile} onGoToUpload={() => router.push("/upload")} onTrySample={handleTrySample} onStartInterview={handleStartInterview} />;
}
