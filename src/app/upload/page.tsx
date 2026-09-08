"use client";

import { UploadScreen } from "@/components/upload/UploadScreen";
import { useAppState } from "@/lib/app-state";

export default function UploadPage() {
  const { bidPack, handleParsed, handleTrySample } = useAppState();
  return <UploadScreen onParsed={handleParsed} currentBidPack={bidPack} onTrySample={handleTrySample} />;
}
