"use client";

import { useRouter } from "next/navigation";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { useAppState } from "@/lib/app-state";

export default function UploadPage() {
  const router = useRouter();
  const { bidPack, profile, handleParsed, handleTrySample } = useAppState();
  return (
    <UploadScreen
      onParsed={handleParsed}
      currentBidPack={bidPack}
      onTrySample={handleTrySample}
      onContinue={() => router.push(profile ? "/results" : "/preferences")}
      continueLabel={profile ? "See my rankings" : "Set my preferences"}
    />
  );
}
