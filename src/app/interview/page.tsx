"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrainInterview } from "@/components/interview/BrainInterview";
import { useAppState } from "@/lib/app-state";

/** The story-driven interview (the pilot brain). The earlier topic-by-topic interview is retired. */
export default function InterviewPage() {
  const router = useRouter();
  const { bidPack, profile, user, interviewKey, handleBrainInterviewComplete } = useAppState();

  useEffect(() => {
    if (!bidPack) router.replace("/upload");
  }, [bidPack, router]);

  if (!bidPack) return null;

  return <BrainInterview key={interviewKey} bidPack={bidPack} onComplete={handleBrainInterviewComplete} priorProfile={profile} userId={user?.id ?? null} />;
}
