"use client";

import { useRouter } from "next/navigation";
import { OpenTimeScreen } from "@/components/open-time/OpenTimeScreen";
import { MembershipLocked } from "@/components/membership/MembershipLocked";
import { useAppState } from "@/lib/app-state";
import { hasAccess } from "@/lib/membership";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function OpenTimePage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleTrySample } = useAppState();
  // No membership: the tool is held back once a pack is in, as Results is. A no-op while `FREE_FOR_ALL` is on.
  if (bidPack && !hasAccess(user)) return <MembershipLocked tool="Open Time" />;
  return (
    <OpenTimeScreen
      bidPack={bidPack}
      seniority={deriveSeniorityInput(bidPack, profile) ?? seniority}
      profile={profile}
      userId={user?.id ?? null}
      onGoToUpload={() => router.push("/upload")}
      onTrySample={handleTrySample}
    />
  );
}
