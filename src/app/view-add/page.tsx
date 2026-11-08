"use client";

import { useRouter } from "next/navigation";
import { ViewAddScreen } from "@/components/view-add/ViewAddScreen";
import { useAppState } from "@/lib/app-state";
import { deriveSeniorityInput } from "@/lib/seniority-derive";

export default function ViewAddPage() {
  const router = useRouter();
  const { bidPack, seniority, profile, user, handleTrySample } = useAppState();
  return (
    <ViewAddScreen
      bidPack={bidPack}
      seniority={deriveSeniorityInput(bidPack, profile) ?? seniority}
      profile={profile}
      userId={user?.id ?? null}
      onGoToUpload={() => router.push("/upload")}
      onTrySample={handleTrySample}
    />
  );
}
