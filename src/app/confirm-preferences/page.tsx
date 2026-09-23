"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ConfirmPreferencesScreen } from "@/components/preferences/ConfirmPreferencesScreen";
import { useAppState } from "@/lib/app-state";
import type { PreferenceWeights } from "@/types/preferences";

export default function ConfirmPreferencesPage() {
  const router = useRouter();
  const { pendingProfile, bidPack, handleConfirmPreferences, handleStartInterview } = useAppState();
  // Confirming (or redoing) clears `pendingProfile` and navigates onward in
  // the same tick — without this, the "nothing to confirm" redirect below sees
  // the cleared profile on this still-mounted page and its `replace` lands
  // AFTER the intended navigation, sending the pilot to Preferences instead of
  // their rankings (or back into the interview they asked to redo).
  const leaving = useRef(false);

  useEffect(() => {
    // A direct/refreshed visit with no pending profile in memory (it's
    // never persisted until confirmed) has nothing to confirm — send them
    // back to preferences instead of a dead blank page.
    if (leaving.current) return;
    if (!pendingProfile || !bidPack) router.replace("/preferences");
  }, [pendingProfile, bidPack, router]);

  if (!pendingProfile || !bidPack) return null;

  return (
    <ConfirmPreferencesScreen
      profile={pendingProfile}
      onConfirm={(weights: PreferenceWeights) => {
        leaving.current = true;
        handleConfirmPreferences(weights);
      }}
      onRetakeInterview={() => {
        leaving.current = true;
        handleStartInterview();
      }}
    />
  );
}
