"use client";

import { LogbookScreen } from "@/components/logbook/LogbookScreen";
import { useAppState } from "@/lib/app-state";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function LogbookPage() {
  const { bidPack, profile, user, seniority, handleUpdateProfile } = useAppState();
  // Already known from the pack's seniority list and the pilot's own number, when both are there.
  const derived = deriveSeniorityInput(bidPack, profile);
  return <LogbookScreen bidPack={bidPack} profile={profile} user={user} seniority={derived ?? seniority} onUpdateProfile={handleUpdateProfile} />;
}
