"use client";

import { useRouter } from "next/navigation";
import { StrategiesScreen } from "@/components/strategies/StrategiesScreen";
import { MembershipLocked } from "@/components/membership/MembershipLocked";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function StrategiesPage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleSaveSeniority, handleStartInterview, handleUpdateProfile, handleTrySample } =
    useAppState();
  // No membership: the tool is held back once a pack is in, as Results is. A no-op while `FREE_FOR_ALL` is on.
  if (bidPack && !hasAccess(user)) return <MembershipLocked tool="Strategies" />;
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
      onTrySample={handleTrySample}
      onGoToResults={() => router.push("/results")}
      onStartInterview={handleStartInterview}
      onUpdateProfile={handleUpdateProfile}
    />
  );
}
