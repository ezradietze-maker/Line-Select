"use client";

import { useRouter } from "next/navigation";
import { StrategiesScreen } from "@/components/strategies/StrategiesScreen";
import { useAppState } from "@/lib/app-state";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function StrategiesPage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleSaveSeniority, handleStartInterview, handleUpdateProfile } =
    useAppState();
  // Already known from the pack's seniority list and the pilot's own number — no need to ask a second time.
  const derived = deriveSeniorityInput(bidPack, profile);
  return (
    <StrategiesScreen
      bidPack={bidPack}
      seniority={derived ?? seniority}
      seniorityFromProfile={!!derived}
      onChangeSeniorityNumber={() => router.push("/preferences")}
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
