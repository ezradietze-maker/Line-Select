"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdaptiveInterview } from "@/components/interview/AdaptiveInterview";
import { useAppState } from "@/lib/app-state";

export default function InterviewPage() {
  const router = useRouter();
  const { bidPack, profile, user, interviewKey, handleInterviewComplete } = useAppState();

  useEffect(() => {
    if (!bidPack) router.replace("/upload");
  }, [bidPack, router]);

  if (!bidPack) return null;

  return (
    <AdaptiveInterview
      key={interviewKey}
      bidPack={bidPack}
      onComplete={handleInterviewComplete}
      priorProfile={profile}
      userId={user?.id ?? null}
    />
  );
}
