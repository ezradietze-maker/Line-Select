"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { AdaptiveInterview } from "@/components/interview/AdaptiveInterview";
import { BrainInterview } from "@/components/interview/BrainInterview";
import { useAppState } from "@/lib/app-state";

export default function InterviewPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <Interview />
    </Suspense>
  );
}

/**
 * The story-driven interview (the pilot brain) by default; the earlier
 * topic-by-topic interview stays reachable at `?classic=1` as a fallback.
 */
function Interview() {
  const router = useRouter();
  const classic = useSearchParams().get("classic") === "1";
  const { bidPack, profile, user, interviewKey, handleInterviewComplete, handleBrainInterviewComplete } = useAppState();

  useEffect(() => {
    if (!bidPack) router.replace("/upload");
  }, [bidPack, router]);

  if (!bidPack) return null;

  if (classic) {
    return <AdaptiveInterview key={interviewKey} bidPack={bidPack} onComplete={handleInterviewComplete} priorProfile={profile} userId={user?.id ?? null} />;
  }
  return <BrainInterview key={interviewKey} bidPack={bidPack} onComplete={handleBrainInterviewComplete} priorProfile={profile} userId={user?.id ?? null} />;
}
