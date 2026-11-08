"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { QuickBrief } from "@/components/interview/QuickBrief";
import { useAppState } from "@/lib/app-state";

/** The one-minute way in, offered beside the full interview. */
export default function QuickBriefPage() {
  const router = useRouter();
  const { bidPack, profile, handleBrainInterviewComplete, handleStartInterview } = useAppState();

  useEffect(() => {
    if (!bidPack) router.replace("/upload");
  }, [bidPack, router]);

  if (!bidPack) return null;

  return <QuickBrief bidPack={bidPack} priorProfile={profile} onComplete={handleBrainInterviewComplete} onFullInterview={handleStartInterview} />;
}
