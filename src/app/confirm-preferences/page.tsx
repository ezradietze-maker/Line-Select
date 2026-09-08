"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ConfirmPreferencesScreen } from "@/components/preferences/ConfirmPreferencesScreen";
import { useAppState } from "@/lib/app-state";

export default function ConfirmPreferencesPage() {
  const router = useRouter();
  const { pendingProfile, bidPack, handleConfirmPreferences, handleStartInterview } = useAppState();

  useEffect(() => {
    // A direct/refreshed visit with no pending profile in memory (it's
    // never persisted until confirmed) has nothing to confirm — send them
    // back to preferences instead of a dead blank page.
    if (!pendingProfile || !bidPack) router.replace("/preferences");
  }, [pendingProfile, bidPack, router]);

  if (!pendingProfile || !bidPack) return null;

  return (
    <ConfirmPreferencesScreen
      profile={pendingProfile}
      onConfirm={handleConfirmPreferences}
      onRetakeInterview={handleStartInterview}
    />
  );
}
