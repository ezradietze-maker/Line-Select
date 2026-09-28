"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { PreviewScreen } from "@/components/upload/PreviewScreen";
import { useAppState } from "@/lib/app-state";

export default function PreviewPage() {
  const router = useRouter();
  const { parseResult, bidPack, handleBidPackConfirmed, handleUploadDifferent } = useAppState();
  // Confirming clears the parse result and navigates onward in the same tick; without this the effect below would see the cleared result and send the pilot back to /upload, racing (and beating) the navigation to Preferences.
  const leaving = useRef(false);

  useEffect(() => {
    // A direct/refreshed visit with no parse result in memory (it's never
    // persisted) has nothing to preview — send them back to upload instead
    // of a dead blank page.
    if (!parseResult && !leaving.current) router.replace("/upload");
  }, [parseResult, router]);

  if (!parseResult) return null;

  return (
    <PreviewScreen
      result={parseResult}
      onConfirm={(confirmed) => {
        leaving.current = true;
        handleBidPackConfirmed(confirmed);
      }}
      onUploadDifferent={() => {
        leaving.current = true;
        handleUploadDifferent();
      }}
      previousSeat={bidPack && !bidPack.id.startsWith("sample") ? bidPack.seat : null}
    />
  );
}
