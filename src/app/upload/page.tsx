"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { UploadScreen } from "@/components/upload/UploadScreen";
import { useAppState } from "@/lib/app-state";

export default function UploadPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <UploadPageContent />
    </Suspense>
  );
}

function UploadPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { bidPack, profile, handleParsed, handleTrySample } = useAppState();
  return (
    <UploadScreen
      onParsed={handleParsed}
      currentBidPack={bidPack}
      onTrySample={handleTrySample}
      onContinue={() => router.push(profile ? "/results" : "/preferences")}
      continueLabel={profile ? "See my rankings" : "Set my preferences"}
      startReplacing={searchParams.has("replace")}
    />
  );
}
