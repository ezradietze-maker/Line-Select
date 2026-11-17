"use client";

import { ToolsScreen } from "@/components/tools/ToolsScreen";
import { MembershipLocked } from "@/components/membership/MembershipLocked";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";

export default function ToolsPage() {
  const { bidPack, profile, user } = useAppState();
  // No membership: the tool is held back once a pack is in, as Results is. A no-op while `FREE_FOR_ALL` is on.
  if (bidPack && !hasAccess(user)) return <MembershipLocked tool="Tools" />;
  return <ToolsScreen bidPack={bidPack} profile={profile} userId={user?.id ?? null} />;
}
