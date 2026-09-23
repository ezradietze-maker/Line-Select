"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PreviewScreen } from "@/components/upload/PreviewScreen";
import { useAppState } from "@/lib/app-state";

export default function PreviewPage() {
  const router = useRouter();
  const { parseResult, bidPack, handleBidPackConfirmed, handleUploadDifferent } = useAppState();

  useEffect(() => {
    // A direct/refreshed visit with no parse result in memory (it's never
    // persisted) has nothing to preview — send them back to upload instead
    // of a dead blank page.
    if (!parseResult) router.replace("/upload");
  }, [parseResult, router]);

  if (!parseResult) return null;

  return (
    <PreviewScreen
      result={parseResult}
      onConfirm={handleBidPackConfirmed}
      onUploadDifferent={handleUploadDifferent}
      previousSeat={bidPack && !bidPack.id.startsWith("sample") ? bidPack.seat : null}
    />
  );
}
