"use client";

import { useRouter } from "next/navigation";
import { OpenTimeScreen } from "@/components/open-time/OpenTimeScreen";
import { useAppState } from "@/lib/app-state";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function OpenTimePage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleTrySample } = useAppState();
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
