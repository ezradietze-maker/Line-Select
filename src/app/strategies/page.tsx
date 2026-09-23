"use client";

import { useRouter } from "next/navigation";
import { StrategiesScreen } from "@/components/strategies/StrategiesScreen";
import { useAppState } from "@/lib/app-state";

export default function StrategiesPage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleSaveSeniority, handleStartInterview, handleUpdateProfile } =
    useAppState();
  return (
    <StrategiesScreen
      bidPack={bidPack}
      seniority={seniority}
      profile={profile}
      user={user}
      onSaveSeniority={handleSaveSeniority}
      onGoToUpload={() => router.push("/upload")}
      onGoToResults={() => router.push("/results")}
      onStartInterview={handleStartInterview}
      onUpdateProfile={handleUpdateProfile}
    />
  );
}
