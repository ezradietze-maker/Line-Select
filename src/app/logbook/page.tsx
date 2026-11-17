"use client";

import { LogbookScreen } from "@/components/logbook/LogbookScreen";
import { MembershipLocked } from "@/components/membership/MembershipLocked";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function LogbookPage() {
  const { bidPack, profile, user, seniority, handleUpdateProfile, handleUpdateProfileWith } = useAppState();
  // No membership: the tool is held back once a pack is in, as Results is. A no-op while `FREE_FOR_ALL` is on.
  if (bidPack && !hasAccess(user)) return <MembershipLocked tool="the Logbook" />;
  // Already known from the pack's seniority list and the pilot's own number, when both are there.
  const derived = deriveSeniorityInput(bidPack, profile);
  return <LogbookScreen bidPack={bidPack} profile={profile} user={user} seniority={derived ?? seniority} onUpdateProfile={handleUpdateProfile} onUpdateProfileWith={handleUpdateProfileWith} />;
}
