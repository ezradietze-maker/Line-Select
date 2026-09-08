"use client";

import { useRouter } from "next/navigation";
import { PreferencesScreen } from "@/components/preferences/PreferencesScreen";
import { useAppState } from "@/lib/app-state";

export default function PreferencesPage() {
  const router = useRouter();
  const { bidPack, profile, handleStartInterview } = useAppState();
  return (
    <PreferencesScreen
      hasBidPack={!!bidPack}
      profile={profile}
      onGoToUpload={() => router.push("/upload")}
      onStartInterview={handleStartInterview}
    />
  );
}
