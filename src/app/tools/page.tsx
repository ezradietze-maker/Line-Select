"use client";

import { ToolsScreen } from "@/components/tools/ToolsScreen";
import { useAppState } from "@/lib/app-state";

export default function ToolsPage() {
  const { bidPack, profile } = useAppState();
  return <ToolsScreen bidPack={bidPack} profile={profile} />;
}
