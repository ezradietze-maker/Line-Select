"use client";

import { ToolsScreen } from "@/components/tools/ToolsScreen";
import { useAppState } from "@/lib/app-state";

export default function ToolsPage() {
  const { bidPack, profile, user } = useAppState();
  return <ToolsScreen bidPack={bidPack} profile={profile} userId={user?.id ?? null} />;
}
